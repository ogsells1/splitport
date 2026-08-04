// frontend/lib/claimLock.ts
// Concurrency guard for claims.
//
// A claim reads what a wallet is owed, sends USDC on-chain, and only then marks
// the rows settled. Reading first leaves a window: two parallel requests (double
// click, two tabs, a retry after a slow response) both see the same PENDING rows
// and both send the transfer, paying one debt twice out of the treasury.
//
// So a run claims its rows before touching the chain. One conditional updateMany
// stamps them with a unique lock id; only rows carrying that id belong to this
// run. A run that wins nothing has nothing to settle.
//
// Locks are timestamped because a process can die between the lock and the
// finalize - without recovery the wallet's funds would stay frozen forever. Any
// lock older than STALE_LOCK_MS is reclaimable by the next run.

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

// Generous enough to cover a cross-chain (CCTP) settlement, which waits on an
// attestation and is far slower than a same-chain transfer. The cost of a too-low
// value is a double-spend window; the cost of a too-high value is a delayed retry.
export const STALE_LOCK_MS = 15 * 60 * 1000;

export type LockedPayout = Awaited<ReturnType<typeof lockedPayouts>>[number];
export type LockedShare = Awaited<ReturnType<typeof lockedShares>>[number];

function lockedPayouts(lockId: string) {
  return prisma.payout.findMany({
    where: { claimLockId: lockId },
    include: { project: { select: { contractAddress: true } } },
  });
}

function lockedShares(lockId: string) {
  return prisma.streamShare.findMany({
    where: { claimLockId: lockId },
    include: { stream: true },
  });
}

export interface ClaimLock {
  lockId: string;
  payouts: LockedPayout[];
  shares: LockedShare[];
}

/**
 * Take exclusive ownership of everything `walletLc` can currently claim.
 *
 * Returns only the rows this run won. A concurrent run gets the rest - or
 * nothing, in which case its `payouts` and `shares` come back empty and it must
 * report "nothing to claim" rather than transferring anything.
 *
 * Always pair with `releaseClaimLock(lockId)` in a `finally`.
 */
export async function acquireClaimLock(walletLc: string): Promise<ClaimLock> {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS);

  // Reclaim rows stranded by a run that died mid-flight.
  await prisma.payout.updateMany({
    where: { wallet: walletLc, status: "PROCESSING", claimLockAt: { lt: staleBefore } },
    data: { status: "PENDING", claimLockId: null, claimLockAt: null },
  });
  await prisma.streamShare.updateMany({
    where: { wallet: walletLc, claimLockId: { not: null }, claimLockAt: { lt: staleBefore } },
    data: { claimLockId: null, claimLockAt: null },
  });

  const lockId = randomUUID();
  const lockedAt = new Date();

  // The conditional updateMany is the guard itself: Postgres serializes the two
  // writers, so the second one matches no rows that the first already took.
  await prisma.payout.updateMany({
    where: { wallet: walletLc, status: "PENDING" },
    data: { status: "PROCESSING", claimLockId: lockId, claimLockAt: lockedAt },
  });
  await prisma.streamShare.updateMany({
    where: { wallet: walletLc, claimLockId: null },
    data: { claimLockId: lockId, claimLockAt: lockedAt },
  });

  const [payouts, shares] = await Promise.all([lockedPayouts(lockId), lockedShares(lockId)]);
  return { lockId, payouts, shares };
}

/**
 * Hand back whatever this run still holds. Rows already finalized cleared their
 * own lock inside the settling transaction, so this only touches what was left
 * unsettled - a failed transfer, a partial claim, or shares that had nothing
 * accrued. Safe to call twice.
 */
export async function releaseClaimLock(lockId: string): Promise<void> {
  await prisma.payout.updateMany({
    where: { claimLockId: lockId, status: "PROCESSING" },
    data: { status: "PENDING", claimLockId: null, claimLockAt: null },
  });
  await prisma.streamShare.updateMany({
    where: { claimLockId: lockId },
    data: { claimLockId: null, claimLockAt: null },
  });
}

/** Fields that clear a row's lock as it is finalized. Spread into the update. */
export const CLEAR_LOCK = { claimLockId: null, claimLockAt: null } as const;
