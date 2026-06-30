// frontend/lib/schedule.ts
// Helpers for computing the next run date of an automatic-payout schedule.

export type Frequency = "WEEKLY" | "MONTHLY" | "CUSTOM";

/**
 * Advance a date by one schedule interval. WEEKLY → +7 days, MONTHLY → +1 month.
 * CUSTOM has no recurring interval (one-shot), so it returns the same date.
 */
export function advanceFrom(date: Date, frequency: Frequency): Date {
  const next = new Date(date);
  if (frequency === "WEEKLY") {
    next.setDate(next.getDate() + 7);
  } else if (frequency === "MONTHLY") {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

/**
 * Compute the first run date for a newly created/updated schedule when the owner
 * doesn't pick an explicit date. WEEKLY/MONTHLY start one interval from now.
 */
export function defaultNextRun(frequency: Frequency, from = new Date()): Date {
  return advanceFrom(from, frequency);
}
