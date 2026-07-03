// frontend/lib/distribute.ts
// Shared custodial-distribution logic used by the manual distribute route, the
// scheduled auto-payout cron, and (via computeShares) streams. Creates one
// claimable Payout per contributor. No on-chain tx.
//
// Two split modes:
//   PERCENTAGE – split an input amount across all contributors by basis points.
//   FIXED      – pay each (selected) contributor their own fixed amount.

import { formatUnits } from "viem";
import { prisma } from "@/lib/prisma";
import { getSettlement } from "@/lib/settlement";

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

export interface ShareLine {
  contributorId: string;
  wallet: string | null;
  amount: bigint;
}

interface ContributorLite {
  id: string;
  wallet: string | null;
  percentage: number;
  fixedAmount: bigint | null;
}

/**
 * Compute per-contributor payout amounts for a project.
 *   PERCENTAGE: needs `amountUsdc`; all contributors share it by basis points
 *               (must sum to 100%); dust remainder stays in the treasury.
 *   FIXED:      each contributor gets their own `fixedAmount`. `contributorIds`
 *               optionally restricts the payout to a chosen subset; omit for all.
 */
export function computeShares(
  splitMode: "PERCENTAGE" | "FIXED",
  contributors: ContributorLite[],
  opts: { amountUsdc?: bigint; contributorIds?: string[] } = {}
): { shares: ShareLine[]; total: bigint } {
  if (contributors.length === 0) {
    throw new DistributionError("Project has no contributors");
  }

  if (splitMode === "FIXED") {
    let selected = contributors;
    if (opts.contributorIds && opts.contributorIds.length > 0) {
      const set = new Set(opts.contributorIds);
      selected = contributors.filter((c) => set.has(c.id));
      if (selected.length === 0) {
        throw new DistributionError("No matching contributors selected.");
      }
    }
    const shares = selected.map((c) => {
      if (c.fixedAmount == null || c.fixedAmount <= 0n) {
        throw new DistributionError("Every selected contributor needs a fixed amount > 0.");
      }
      return {
        contributorId: c.id,
        wallet: c.wallet ? c.wallet.toLowerCase() : null,
        amount: c.fixedAmount,
      };
    });
    return { shares, total: shares.reduce((s, x) => s + x.amount, 0n) };
  }

  // PERCENTAGE
  if (opts.amountUsdc == null || opts.amountUsdc <= 0n) {
    throw new DistributionError("Amount must be greater than 0.");
  }
  const totalBps = contributors.reduce((s, c) => s + c.percentage, 0);
  if (totalBps !== 10000) {
    throw new DistributionError(
      `Contributor percentages must sum to 100% (got ${totalBps / 100}%).`
    );
  }
  const shares = contributors.map((c) => ({
    contributorId: c.id,
    wallet: c.wallet ? c.wallet.toLowerCase() : null,
    amount: (opts.amountUsdc! * BigInt(c.percentage)) / 10000n,
  }));
  return { shares, total: shares.reduce((s, x) => s + x.amount, 0n) };
}

/**
 * Distribute from the treasury across a project's contributors. PERCENTAGE needs
 * `amountUsdc`; FIXED ignores it and pays fixed amounts (optionally to the subset
 * named by `contributorIds`). If `ownerPrivyId` is provided ownership is enforced
 * (manual path); omit it for system-initiated runs (cron).
 */
export async function runDistribution(opts: {
  contractAddress: string;
  amountUsdc?: bigint;
  contributorIds?: string[];
  ownerPrivyId?: string;
}): Promise<DistributionResult> {
  const { contractAddress, amountUsdc, contributorIds, ownerPrivyId } = opts;

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

  // Distribution is allowed even before invites are claimed: a contributor who
  // hasn't linked a wallet yet gets a reserved payout (wallet = null) that
  // becomes claimable once they accept their invite.
  const { shares, total } = computeShares(project.splitMode, project.contributors, {
    amountUsdc,
    contributorIds,
  });

  const settlement = getSettlement();

  // Treasury balance: custodial = DB sum; vault = on-chain vault balance.
  const available = await settlement.availableBalance(project.owner.id, project.contractAddress);
  if (total > available) {
    throw new DistributionError(
      `Insufficient treasury balance. Available: ${formatUnits(available, 6)} USDC.`
    );
  }

  const { distributionId } = await settlement.settleDistribution(
    project.id,
    shares,
    total,
    project.contractAddress
  );

  return { distributionId, distributed: total, payouts: shares.length };
}
