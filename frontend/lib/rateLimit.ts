// frontend/lib/rateLimit.ts
// Fixed-window rate limiting for the expensive routes.
//
// Authentication bounds who may call these endpoints, not how often. A single
// signed-in account can still hammer /api/cabinet/claim, and each attempt costs
// RPC calls and potentially executor gas - so the money-touching routes need a
// ceiling per caller, not just a check that a caller exists.
//
// Counters live in Postgres, not in memory: a module-level counter on Vercel is
// per serverless instance, so a caller would get one full quota per warm
// instance. The same reasoning as lib/settlement's mode override.
//
// Fixed windows (rather than a sliding log) are deliberate: one row and one
// atomic increment per request, no per-request history to store or trim. The
// known trade-off is that a caller can spend their quota at the very end of one
// window and again at the start of the next, so an adversary gets up to 2x the
// limit across a window boundary. Limits below are set with that in mind.

import { prisma } from "@/lib/prisma";

export interface RateLimitRule {
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export const RATE_LIMITS = {
  // Each claim can trigger an on-chain transfer paid for with executor gas.
  claim: { limit: 10, windowMs: 60_000 },
  // Heavy DB + RPC work, but a legitimate owner may run several in a row.
  distribute: { limit: 20, windowMs: 60_000 },
  // Public and unauthenticated - the only limit keyed by IP.
  inviteLookup: { limit: 60, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

export class RateLimitError extends Error {
  status = 429;
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Too many requests. Please wait a moment and try again.");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Count one request against `key`. Throws RateLimitError once the caller is over
 * the limit for the current window.
 *
 * A storage failure is logged and allowed through: the limiter protects against
 * abuse, and it must not become a way to take the whole app down when the
 * counter table is unreachable.
 */
export async function enforceRateLimit(
  scope: keyof typeof RATE_LIMITS,
  caller: string
): Promise<void> {
  const { limit, windowMs } = RATE_LIMITS[scope];
  const key = `${scope}:${caller}`;
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);

  let count: number;
  try {
    // upsert compiles to INSERT ... ON CONFLICT DO UPDATE, so the increment is
    // atomic and two parallel requests cannot both read the same stale count.
    const row = await prisma.rateLimit.upsert({
      where: { key_windowStart: { key, windowStart } },
      create: { key, windowStart, count: 1 },
      update: { count: { increment: 1 } },
    });
    count = row.count;
  } catch (err) {
    console.error("[rateLimit] counter unavailable, allowing request", err);
    return;
  }

  if (count > limit) {
    const retryAfter = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000));
    throw new RateLimitError(retryAfter);
  }
}

/** Caller identity for unauthenticated routes. Falls back to a shared bucket. */
export function callerIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
  return ip || "unknown";
}

/** Delete counters for windows that can no longer be current. */
export async function pruneRateLimits(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const { count } = await prisma.rateLimit.deleteMany({ where: { windowStart: { lt: cutoff } } });
  return count;
}
