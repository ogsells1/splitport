// frontend/lib/stream.ts
// Accrual math for Superfluid-style payout streams. A share's value grows linearly
// from 0 at startAt to its full `amount` at endAt; claimable = accrued − claimed.
// Computed on read - no cron drips the balance.

export type StreamStatusLite = "ACTIVE" | "CANCELED";

/**
 * How much of a share's total `amount` has accrued by `asOf`. Clamped to
 * [0, amount]. Uses integer math on millisecond timestamps.
 */
export function accruedAmount(
  amount: bigint,
  startAt: Date,
  endAt: Date,
  asOf: Date = new Date()
): bigint {
  const start = startAt.getTime();
  const end = endAt.getTime();
  const now = asOf.getTime();

  if (now <= start) return 0n;
  if (now >= end || end <= start) return amount;

  const elapsed = BigInt(now - start);
  const window = BigInt(end - start);
  return (amount * elapsed) / window;
}

/**
 * Claimable amount from a share right now. A canceled stream stops accruing and
 * forfeits the unclaimed remainder, so its claimable drops to 0.
 */
export function claimableNow(
  share: { amount: bigint; claimedAmount: bigint },
  stream: { startAt: Date; endAt: Date; status: StreamStatusLite },
  asOf: Date = new Date()
): bigint {
  if (stream.status === "CANCELED") return 0n;
  const accrued = accruedAmount(share.amount, stream.startAt, stream.endAt, asOf);
  const claimable = accrued - share.claimedAmount;
  return claimable > 0n ? claimable : 0n;
}
