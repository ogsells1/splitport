import { isAddress, formatUnits } from "viem";
import { prisma } from "@/lib/prisma";
import { getAvailableBalance } from "@/lib/treasuryBalance";
import { claimableNow } from "@/lib/stream";
import { getCircleUsdcBalance, estimateCircleFee, circleTransferUsdc } from "@/lib/circleWallet";
import { resolvePayoutAddress } from "./payoutDestination";
import type { SettlementProvider, ShareLine } from "./types";

// Same custodial ledger as CustodialSettlement (Postgres-tracked payouts/streams),
// but the actual on-chain transfer is signed by a Circle Developer-Controlled
// Wallet instead of the viem EXECUTOR_PRIVATE_KEY.
export class CircleSettlement implements SettlementProvider {
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
    if (!isAddress(wallet)) throw new Error("Invalid wallet address");

    const to = await resolvePayoutAddress(wallet);
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
    const totalOwed = grossPayouts + grossStreams;
    if (totalOwed === 0n) throw new Error("Nothing to claim");

    const circleBalance = await getCircleUsdcBalance();

    // Partial claim: if the Circle wallet doesn't have enough for everything,
    // greedily select full items (smallest first) that fit. The rest stay PENDING.
    let selectedPayouts = pending;
    let selectedStreams = streamClaims;
    let gross = totalOwed;

    if (circleBalance < totalOwed) {
      type Item =
        | { kind: "payout"; data: (typeof pending)[number]; amount: bigint }
        | { kind: "stream"; data: (typeof streamClaims)[number]; amount: bigint };

      const items: Item[] = [
        ...pending.map((p) => ({ kind: "payout" as const, data: p, amount: p.amount })),
        ...streamClaims.map((c) => ({ kind: "stream" as const, data: c, amount: c.amount })),
      ].sort((a, b) => (a.amount < b.amount ? -1 : 1));

      let budget = circleBalance;
      const pickedPayouts: typeof pending = [];
      const pickedStreams: typeof streamClaims = [];

      for (const item of items) {
        if (item.amount <= budget) {
          budget -= item.amount;
          if (item.kind === "payout") pickedPayouts.push(item.data);
          else pickedStreams.push(item.data);
        }
      }

      if (pickedPayouts.length === 0 && pickedStreams.length === 0) {
        const partialGross = circleBalance;
        let partialFee: bigint;
        try {
          partialFee = await estimateCircleFee(to, partialGross);
        } catch {
          partialFee = 0n;
        }
        const partialNet = partialGross > partialFee ? partialGross - partialFee : 0n;
        if (partialNet === 0n) {
          throw Object.assign(
            new Error(
              `Circle wallet balance (${formatUnits(circleBalance, 6)} USDC) is too low to cover the transfer fee. Top it up and try again.`
            ),
            { status: 409 }
          );
        }

        const partialTxHash = await circleTransferUsdc(to, partialNet);

        const target = items[0];
        if (target.kind === "payout") {
          const remaining = target.amount - partialNet;
          await prisma.payout.update({
            where: { id: target.data.id },
            data: remaining > 0n
              ? { amount: remaining }
              : { status: "CLAIMED", txHash: partialTxHash, netAmount: partialNet, feeAmount: partialFee, claimedAt: new Date() },
          });
        } else {
          await prisma.streamShare.update({
            where: { id: target.data.share.id },
            data: { claimedAmount: target.data.share.claimedAmount + partialNet },
          });
          await prisma.streamClaim.create({
            data: {
              shareId: target.data.share.id,
              amount: partialNet + partialFee,
              feeAmount: partialFee,
              netAmount: partialNet,
              txHash: partialTxHash,
              claimedAt: new Date(),
            },
          });
        }

        return { txHash: partialTxHash, gross: partialGross, fee: partialFee, net: partialNet };
      }

      selectedPayouts = pickedPayouts;
      selectedStreams = pickedStreams;
      gross =
        selectedPayouts.reduce((s, p) => s + p.amount, 0n) +
        selectedStreams.reduce((s, c) => s + c.amount, 0n);
    }

    let fee: bigint;
    try {
      fee = await estimateCircleFee(to, gross);
    } catch {
      throw Object.assign(
        new Error("Could not estimate the Circle transfer fee. Try again shortly."),
        { status: 502 }
      );
    }

    if (gross <= fee) throw new Error("Your balance is too small to cover the transfer fee yet.");
    const net = gross - fee;

    const txHash = await circleTransferUsdc(to, net);

    const claimedAt = new Date();
    await prisma.$transaction(async (tx) => {
      let i = 0;
      for (const p of selectedPayouts) {
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
      for (const c of selectedStreams) {
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
