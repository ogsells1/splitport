import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { prisma } from "@/lib/prisma";
import { getExecutor } from "@/lib/executor";
import { USDC_ADDRESS, USDC_ABI } from "@/lib/contract";
import { getAvailableBalance } from "@/lib/treasuryBalance";
import { claimableNow } from "@/lib/stream";
import type { SettlementProvider, ShareLine } from "./types";

export class CustodialSettlement implements SettlementProvider {
  readonly mode = "custodial" as const;

  availableBalance(ownerId: string, _contractAddress?: string): Promise<bigint> {
    return getAvailableBalance(ownerId);
  }

  async settleDistribution(
    projectId: string,
    shares: ShareLine[],
    total: bigint,
    _contractAddress?: string
  ): Promise<{ distributionId: string; txHash?: string }> {
    const distributionId = await prisma.$transaction(async (tx) => {
      const distribution = await tx.distribution.create({
        data: { projectId, total },
      });
      await tx.payout.createMany({
        data: shares.map((s) => ({
          distributionId: distribution.id,
          projectId,
          contributorId: s.contributorId,
          wallet: s.wallet,
          amount: s.amount,
        })),
      });
      return distribution.id;
    });
    return { distributionId };
  }

  async settleClaim(wallet: string, _contractAddress?: string): Promise<{
    txHash: string;
    gross: bigint;
    fee: bigint;
    net: bigint;
  }> {
    const executor = getExecutor();
    if (!executor) {
      throw Object.assign(
        new Error("Claims are not configured (missing EXECUTOR_PRIVATE_KEY)."),
        { status: 503 }
      );
    }
    if (!isAddress(wallet)) throw new Error("Invalid wallet address");

    const walletLc = wallet.toLowerCase();
    const now = new Date();
    const [pending, shares] = await Promise.all([
      prisma.payout.findMany({ where: { wallet: walletLc, status: "PENDING" } }),
      prisma.streamShare.findMany({
        where: { wallet: walletLc },
        include: { stream: true },
      }),
    ]);

    const streamClaims = shares
      .map((sh) => ({ share: sh, amount: claimableNow(sh, sh.stream, now) }))
      .filter((c) => c.amount > 0n);

    const grossPayouts = pending.reduce((s, p) => s + p.amount, 0n);
    const grossStreams = streamClaims.reduce((s, c) => s + c.amount, 0n);
    const gross = grossPayouts + grossStreams;
    if (gross === 0n) throw new Error("Nothing to claim");

    const { walletClient, publicClient, account } = executor;
    const usdc = getAddress(USDC_ADDRESS) as Address;
    const to = getAddress(wallet) as Address;

    const onChainBalance = (await publicClient.readContract({
      address: usdc,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;
    if (onChainBalance < gross) {
      throw Object.assign(
        new Error(
          `Payout wallet doesn't hold enough USDC to cover this claim yet (needs ${formatUnits(gross, 6)}, has ${formatUnits(onChainBalance, 6)}). Top it up and try again.`
        ),
        { status: 409 }
      );
    }

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
      const feeWei = (gas * gasPrice * 12n) / 10n;
      fee = feeWei / 10n ** 12n;
    } catch {
      throw Object.assign(
        new Error("Could not estimate the transfer fee. Try again shortly."),
        { status: 502 }
      );
    }

    if (gross <= fee) throw new Error("Your balance is too small to cover the transfer fee yet.");
    const net = gross - fee;

    const txHash = await walletClient.writeContract({
      address: usdc,
      abi: USDC_ABI,
      functionName: "transfer",
      args: [to, net],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });

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

    return { txHash, gross, fee, net };
  }
}
