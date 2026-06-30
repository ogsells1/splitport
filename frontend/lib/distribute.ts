// frontend/lib/distribute.ts
// Shared custodial-distribution logic used by both the manual distribute route
// (POST /api/treasury/distribute) and the scheduled auto-payout cron
// (GET /api/treasury/schedule/run). Splits an amount from the project owner's
// treasury across the project's active contributors by basis points, creating
// one claimable Payout per contributor. No on-chain tx.

import { formatUnits } from "viem";
import { prisma } from "@/lib/prisma";
import { getAvailableBalance } from "@/lib/treasuryBalance";

export class DistributionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface DistributionResult {
  distributionId: string;
  distributed: bigint;
  payouts: number;
}

/**
 * Distribute `amountUsdc` (6-decimal USDC units) from the treasury across a
 * project's contributors. If `ownerPrivyId` is provided, ownership is enforced
 * (manual path); pass it omitted for system-initiated runs (cron).
 */
export async function runDistribution(opts: {
  contractAddress: string;
  amountUsdc: bigint;
  ownerPrivyId?: string;
}): Promise<DistributionResult> {
  const { contractAddress, amountUsdc, ownerPrivyId } = opts;

  if (amountUsdc <= 0n) {
    throw new DistributionError("Amount must be greater than 0.");
  }

  const project = await prisma.project.findUnique({
    where: { contractAddress },
    include: { owner: true, contributors: { where: { active: true } } },
  });
  if (!project) {
    throw new DistributionError("Project not found", 404);
  }
  if (ownerPrivyId && project.owner.privyId !== ownerPrivyId) {
    throw new DistributionError("Forbidden", 403);
  }

  const contributors = project.contributors;
  if (contributors.length === 0) {
    throw new DistributionError("Project has no contributors");
  }
  // Distribution is allowed even before invites are claimed: a contributor who
  // hasn't linked a wallet yet gets a reserved payout (wallet = null) that
  // becomes claimable once they accept their invite.
  const totalBps = contributors.reduce((s, c) => s + c.percentage, 0);
  if (totalBps !== 10000) {
    throw new DistributionError(
      `Contributor percentages must sum to 100% (got ${totalBps / 100}%).`
    );
  }

  // Treasury balance: confirmed deposits − lump-sum distributions − stream buffers.
  const owner = project.owner;
  const available = await getAvailableBalance(owner.id);

  if (amountUsdc > available) {
    throw new DistributionError(
      `Insufficient treasury balance. Available: ${formatUnits(available, 6)} USDC.`
    );
  }

  // Split by basis points. Remainder (dust) stays in the treasury.
  const shares = contributors.map((c) => ({
    contributorId: c.id,
    wallet: c.wallet ? c.wallet.toLowerCase() : null,
    amount: (amountUsdc * BigInt(c.percentage)) / 10000n,
  }));
  const distributedSum = shares.reduce((s, x) => s + x.amount, 0n);

  const result = await prisma.$transaction(async (tx) => {
    const distribution = await tx.distribution.create({
      data: { projectId: project.id, total: distributedSum },
    });
    await tx.payout.createMany({
      data: shares.map((s) => ({
        distributionId: distribution.id,
        projectId: project.id,
        contributorId: s.contributorId,
        wallet: s.wallet,
        amount: s.amount,
      })),
    });
    return distribution;
  });

  return {
    distributionId: result.id,
    distributed: distributedSum,
    payouts: shares.length,
  };
}
