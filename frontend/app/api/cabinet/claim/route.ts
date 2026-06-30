// frontend/app/api/cabinet/claim/route.ts
// POST /api/cabinet/claim — a contributor claims everything owed: pending lump-sum
// payouts plus accrued-but-unclaimed stream funds. The executor wallet sends
// (total − transfer fee) USDC in a single transfer and pays the gas; the fee is
// deducted from the contributor's share, so they cover the transfer cost out of
// their own money.

import { NextResponse } from "next/server";
import { getAddress, isAddress, type Address } from "viem";
import { prisma } from "@/lib/prisma";
import { getExecutor } from "@/lib/executor";
import { USDC_ADDRESS, USDC_ABI } from "@/lib/contract";
import { claimableNow } from "@/lib/stream";

export async function POST(request: Request) {
  try {
    const executor = getExecutor();
    if (!executor) {
      return NextResponse.json(
        { error: "Claims are not configured (missing EXECUTOR_PRIVATE_KEY)." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { wallet } = body;
    if (!wallet || !isAddress(wallet)) {
      return NextResponse.json({ error: "A valid wallet is required" }, { status: 400 });
    }

    const walletLc = wallet.toLowerCase();
    const now = new Date();
    const [pending, shares] = await Promise.all([
      prisma.payout.findMany({ where: { wallet: walletLc, status: "PENDING" } }),
      prisma.streamShare.findMany({
        where: { wallet: walletLc },
        include: { stream: true },
      }),
    ]);

    // Snapshot the accrued-but-unclaimed amount per stream share at `now`; we claim
    // exactly this snapshot so we never pull more than what has accrued.
    const streamClaims = shares
      .map((sh) => ({ share: sh, amount: claimableNow(sh, sh.stream, now) }))
      .filter((c) => c.amount > 0n);

    const grossPayouts = pending.reduce((s, p) => s + p.amount, 0n);
    const grossStreams = streamClaims.reduce((s, c) => s + c.amount, 0n);
    const gross = grossPayouts + grossStreams;
    if (gross === 0n) {
      return NextResponse.json({ error: "Nothing to claim" }, { status: 400 });
    }

    const { walletClient, publicClient, account } = executor;
    const usdc = getAddress(USDC_ADDRESS) as Address;
    const to = getAddress(wallet) as Address;

    // Estimate the transfer fee (gas in USDC on Arc) and deduct it from the payout.
    let fee: bigint;
    try {
      const gas = await publicClient.estimateContractGas({
        address: usdc,
        abi: USDC_ABI,
        functionName: "transfer",
        args: [to, gross],
        account,
      });
      const gasPrice = await publicClient.getGasPrice();
      // Gas is paid in the 18-decimal native token; the payout is 6-decimal USDC.
      // Convert native wei → USDC units (divide by 10^(18-6)) and pad 20% so the
      // deducted fee comfortably covers actual gas.
      const feeWei = (gas * gasPrice * 12n) / 10n;
      fee = feeWei / 10n ** 12n;
    } catch {
      return NextResponse.json(
        { error: "Could not estimate the transfer fee. Try again shortly." },
        { status: 502 }
      );
    }

    if (gross <= fee) {
      return NextResponse.json(
        { error: "Your balance is too small to cover the transfer fee yet." },
        { status: 400 }
      );
    }
    const net = gross - fee;

    // Executor must actually hold enough USDC on-chain to pay out + gas.
    const onChainBalance = (await publicClient.readContract({
      address: usdc,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;
    if (onChainBalance < net) {
      return NextResponse.json(
        { error: "Payout wallet is temporarily underfunded. Please try again later." },
        { status: 409 }
      );
    }

    const txHash = await walletClient.writeContract({
      address: usdc,
      abi: USDC_ABI,
      functionName: "transfer",
      args: [to, net],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Record everything claimed. The full tx hash goes on the first row; the rest
    // get a synthetic suffix to satisfy the unique constraint while staying
    // traceable. The fee/net is split proportionally across all claimed amounts.
    const claimedAt = new Date();
    await prisma.$transaction(async (tx) => {
      let i = 0;
      for (const p of pending) {
        const feeShare = (fee * p.amount) / gross;
        await tx.payout.update({
          where: { id: p.id },
          data: {
            status: "CLAIMED",
            txHash: i === 0 ? txHash : `${txHash}-${i}`,
            feeAmount: feeShare,
            netAmount: p.amount - feeShare,
            claimedAt,
          },
        });
        i++;
      }
      for (const c of streamClaims) {
        const feeShare = (fee * c.amount) / gross;
        // Advance how much of the share has been pulled, and log the drip.
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
            txHash: i === 0 ? txHash : `${txHash}-${i}`,
            claimedAt,
          },
        });
        i++;
      }
    });

    return NextResponse.json({
      txHash,
      gross: gross.toString(),
      fee: fee.toString(),
      net: net.toString(),
    });
  } catch (error: any) {
    console.error("[POST /api/cabinet/claim]", error);
    return NextResponse.json(
      { error: error?.shortMessage ?? error?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
