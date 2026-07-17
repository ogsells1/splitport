import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { prisma } from "@/lib/prisma";
import { getExecutor } from "@/lib/executor";
import { USDC_ADDRESS, USDC_ABI } from "@/lib/contract";
import { getAvailableBalance } from "@/lib/treasuryBalance";
import { claimableNow } from "@/lib/stream";
import { resolvePayoutAddress } from "./payoutDestination";
import { bridgeUsdcFromArc, type BridgeDestination } from "@/lib/bridgeKit";
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

  async settleClaim(wallet: string, _contractAddress?: string, destinationChain?: BridgeDestination): Promise<{
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
    const totalOwed = grossPayouts + grossStreams;
    if (totalOwed === 0n) throw new Error("Nothing to claim");

    const { walletClient, publicClient, account } = executor;
    const usdc = getAddress(USDC_ADDRESS) as Address;
    const to = getAddress(await resolvePayoutAddress(wallet)) as Address;

    const onChainBalance = (await publicClient.readContract({
      address: usdc,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;

    // Partial claim: if the executor doesn't have enough for everything, greedily
    // select full items (smallest first) that fit within the available balance.
    // Remaining items stay PENDING for the next claim.
    let selectedPayouts = pending;
    let selectedStreams = streamClaims;
    let gross = totalOwed;

    if (onChainBalance < totalOwed) {
      // Build a list of all claimable items sorted by amount ascending.
      type Item =
        | { kind: "payout"; data: (typeof pending)[number]; amount: bigint }
        | { kind: "stream"; data: (typeof streamClaims)[number]; amount: bigint };

      const items: Item[] = [
        ...pending.map((p) => ({ kind: "payout" as const, data: p, amount: p.amount })),
        ...streamClaims.map((c) => ({ kind: "stream" as const, data: c, amount: c.amount })),
      ].sort((a, b) => (a.amount < b.amount ? -1 : 1));

      let budget = onChainBalance;
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
        // No whole item fits - do a partial transfer of everything available.
        // The first (smallest) payout is partially paid; its remaining amount
        // stays PENDING so the user can claim the rest once executor is topped up.
        const partialGross = onChainBalance;
        let partialFee: bigint;
        try {
          const gas = await publicClient.estimateContractGas({
            address: usdc, abi: USDC_ABI, functionName: "transfer",
            args: [to, partialGross], account,
          });
          const gasPrice = await publicClient.getGasPrice();
          partialFee = ((gas * gasPrice * 12n) / 10n) / 10n ** 12n;
        } catch {
          partialFee = 0n;
        }
        const partialNet = partialGross > partialFee ? partialGross - partialFee : 0n;
        if (partialNet === 0n) {
          throw Object.assign(
            new Error(
              `Payout wallet balance (${formatUnits(onChainBalance, 6)} USDC) is too low to cover the transfer fee. Top it up and try again.`
            ),
            { status: 409 }
          );
        }

        const partialTxHash = destinationChain
          ? (await bridgeUsdcFromArc(destinationChain, to, formatUnits(partialNet, 6))).txHash
          : await (async () => {
              const hash = await walletClient.writeContract({
                address: usdc, abi: USDC_ABI, functionName: "transfer", args: [to, partialNet],
              });
              await publicClient.waitForTransactionReceipt({ hash });
              return hash;
            })();

        // Reduce the first payout by the net transferred; keep it PENDING for the rest.
        const target = items[0]; // smallest item
        if (target.kind === "payout") {
          const remaining = target.amount - partialNet;
          await prisma.payout.update({
            where: { id: target.data.id },
            data: remaining > 0n
              ? { amount: remaining }
              : { status: "CLAIMED", txHash: partialTxHash, netAmount: partialNet, feeAmount: partialFee, claimedAt: new Date() },
          });
        } else {
          // stream share - advance claimedAmount
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

    // Fee estimate is based on a same-chain transfer even when bridging - CCTP's
    // approve+burn+mint costs more, but this keeps the contributor-facing fee
    // math simple and consistent for a testnet demo. Revisit with Bridge Kit's
    // own cost-estimation API before handling non-trivial mainnet amounts.
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

    const txHash = destinationChain
      ? (await bridgeUsdcFromArc(destinationChain, to, formatUnits(net, 6))).txHash
      : await (async () => {
          const hash = await walletClient.writeContract({
            address: usdc, abi: USDC_ABI, functionName: "transfer", args: [to, net],
          });
          await publicClient.waitForTransactionReceipt({ hash });
          return hash;
        })();

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
