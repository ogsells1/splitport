// frontend/app/api/cabinet/claim/route.ts
// POST /api/cabinet/claim — a contributor claims everything owed to their wallet.
//
// Custodial: executor sends USDC (lump-sum payouts + stream accruals) in one transfer.
// Vault (onchain):
//   • Lump-sum payouts — executor calls claimFor() on each vault.
//   • Streaming — still custodial (deferred to Phase 4+); settled via executor transfer.

import { NextResponse } from "next/server";
import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { prisma } from "@/lib/prisma";
import { getSettlement } from "@/lib/settlement";
import { getExecutor } from "@/lib/executor";
import { USDC_ADDRESS, USDC_ABI } from "@/lib/contract";
import { claimableNow } from "@/lib/stream";
import { requireWallet, authErrorResponse } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { wallet } = body;
    if (!wallet || !isAddress(wallet)) {
      return NextResponse.json({ error: "A valid wallet is required" }, { status: 400 });
    }

    try {
      await requireWallet(request, wallet);
    } catch (e) {
      const { error, status } = authErrorResponse(e);
      return NextResponse.json({ error }, { status });
    }

    const settlement = getSettlement();

    if (settlement.mode === "onchain") {
      return await claimOnchain(wallet);
    }

    // Custodial mode — all logic in settlement layer.
    const { txHash, gross, fee, net } = await settlement.settleClaim(wallet);
    return NextResponse.json({
      txHash,
      gross: gross.toString(),
      fee: fee.toString(),
      net: net.toString(),
    });
  } catch (error: any) {
    console.error("[POST /api/cabinet/claim]", error);
    const status = error?.status ?? 500;
    return NextResponse.json(
      { error: error?.shortMessage ?? error?.message ?? "Internal server error" },
      { status }
    );
  }
}

async function claimOnchain(wallet: string) {
  const walletLc = wallet.toLowerCase();
  const now = new Date();

  // ── Part 1: vault payouts (on-chain claimFor per vault) ─────────────────────
  const pendingPayouts = await prisma.payout.findMany({
    where: { wallet: walletLc, status: "PENDING" },
    include: { project: { select: { contractAddress: true } } },
  });

  const byVault = new Map<string, typeof pendingPayouts>();
  for (const p of pendingPayouts) {
    const addr = p.project.contractAddress;
    if (!isAddress(addr)) continue;
    const list = byVault.get(addr) ?? [];
    list.push(p);
    byVault.set(addr, list);
  }

  let vaultGross = 0n;
  const vaultTxHashes: string[] = [];

  if (byVault.size > 0) {
    const settlement = getSettlement();
    for (const [contractAddress, payouts] of byVault) {
      const { txHash, gross } = await settlement.settleClaim(wallet, contractAddress);
      vaultTxHashes.push(txHash);
      vaultGross += gross;

      const claimedAt = new Date();
      await prisma.$transaction(
        payouts.map((p) =>
          prisma.payout.update({
            where: { id: p.id },
            data: { status: "CLAIMED", txHash, claimedAt, netAmount: p.amount, feeAmount: 0n },
          })
        )
      );
    }
  }

  // ── Part 2: stream accruals (custodial fallback — streams deferred to Phase 4+) ──
  const shares = await prisma.streamShare.findMany({
    where: { wallet: walletLc },
    include: { stream: true },
  });
  const streamClaims = shares
    .map((sh) => ({ share: sh, amount: claimableNow(sh, sh.stream, now) }))
    .filter((c) => c.amount > 0n);
  const streamGross = streamClaims.reduce((s, c) => s + c.amount, 0n);

  let streamTxHash: string | undefined;
  let streamFee = 0n;

  if (streamGross > 0n) {
    const executor = getExecutor();
    if (!executor) {
      if (vaultGross === 0n) {
        throw Object.assign(
          new Error("Claims are not configured (missing EXECUTOR_PRIVATE_KEY)."),
          { status: 503 }
        );
      }
      // Has vault payout but no executor for streams — skip stream part.
    } else {
      const { walletClient, publicClient, account } = executor;
      const usdc = getAddress(USDC_ADDRESS) as Address;
      const to = getAddress(wallet) as Address;

      const onChainBalance = (await publicClient.readContract({
        address: usdc,
        abi: USDC_ABI,
        functionName: "balanceOf",
        args: [account.address],
      })) as bigint;

      if (onChainBalance >= streamGross) {
        let fee: bigint;
        try {
          const gas = await publicClient.estimateContractGas({
            address: usdc, abi: USDC_ABI, functionName: "transfer",
            args: [to, streamGross], account,
          });
          const gasPrice = await publicClient.getGasPrice();
          fee = ((gas * gasPrice * 12n) / 10n) / 10n ** 12n;
        } catch {
          fee = 0n;
        }

        if (streamGross > fee) {
          const net = streamGross - fee;
          const rawHash = await walletClient.writeContract({
            address: usdc, abi: USDC_ABI, functionName: "transfer", args: [to, net],
          });
          streamTxHash = rawHash;
          await publicClient.waitForTransactionReceipt({ hash: rawHash });
          streamFee = fee;

          const claimedAt = new Date();
          await prisma.$transaction(async (tx) => {
            let i = 0;
            for (const c of streamClaims) {
              const feeShare = streamGross > 0n ? (fee * c.amount) / streamGross : 0n;
              await tx.streamShare.update({
                where: { id: c.share.id },
                data: { claimedAmount: c.share.claimedAmount + c.amount },
              });
              await tx.streamClaim.create({
                data: {
                  shareId: c.share.id,
                  amount: c.amount,
                  feeAmount: feeShare,
                  netAmount: c.amount - feeShare,
                  txHash: (i === 0 ? streamTxHash! : `${streamTxHash}-${i}`) as `0x${string}`,
                  claimedAt,
                },
              });
              i++;
            }
          });
        }
      }
    }
  }

  const totalGross = vaultGross + streamGross;
  const totalFee   = streamFee;
  const totalNet   = vaultGross + (streamGross > streamFee ? streamGross - streamFee : 0n);

  if (totalGross === 0n) {
    return NextResponse.json({ error: "Nothing to claim" }, { status: 400 });
  }

  return NextResponse.json({
    txHash: vaultTxHashes[0] ?? streamTxHash,
    txHashes: [...vaultTxHashes, ...(streamTxHash ? [streamTxHash] : [])],
    gross: totalGross.toString(),
    fee: totalFee.toString(),
    net: totalNet.toString(),
  });
}
