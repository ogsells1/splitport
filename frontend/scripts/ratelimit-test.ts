// Checks the rate limiter actually blocks, counts atomically under concurrency,
// and prunes. Uses a throwaway key and cleans up after itself.
//
// Run: npx tsx scripts/ratelimit-test.ts

import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { enforceRateLimit, RateLimitError, RATE_LIMITS, pruneRateLimits } = await import(
    "@/lib/rateLimit"
  );

  const caller = `test-${Date.now()}`;
  const { limit } = RATE_LIMITS.claim;
  const attempts = limit + 5;

  try {
    // Sequential: the (limit+1)-th call must be refused.
    let allowed = 0;
    let refused = 0;
    let retryAfter = 0;
    for (let i = 0; i < attempts; i++) {
      try {
        await enforceRateLimit("claim", caller);
        allowed++;
      } catch (e) {
        if (e instanceof RateLimitError) {
          refused++;
          retryAfter = e.retryAfterSeconds;
        } else throw e;
      }
    }
    const seqPass = allowed === limit && refused === attempts - limit;
    console.log(
      `sequential: ${allowed} allowed / ${refused} refused of ${attempts} ` +
        `(limit ${limit}) -> ${seqPass ? "PASS" : "FAIL"}`
    );
    console.log(`Retry-After reported: ${retryAfter}s`);

    // Concurrent: parallel requests must not both read a stale count and slip
    // past the limit - the increment has to be atomic.
    const concurrentCaller = `test-conc-${Date.now()}`;
    const results = await Promise.all(
      Array.from({ length: limit + 10 }, () =>
        enforceRateLimit("claim", concurrentCaller).then(
          () => "allowed" as const,
          (e) => (e instanceof RateLimitError ? ("refused" as const) : Promise.reject(e))
        )
      )
    );
    const concAllowed = results.filter((r) => r === "allowed").length;
    const concPass = concAllowed === limit;
    console.log(
      `concurrent: ${concAllowed} allowed of ${results.length} fired at once ` +
        `(expected exactly ${limit}) -> ${concPass ? "PASS" : "FAIL"}`
    );

    // Prune removes only windows old enough to be irrelevant.
    const before = await prisma.rateLimit.count();
    const pruned = await pruneRateLimits(0); // treat every window as stale
    const after = await prisma.rateLimit.count();
    const prunePass = pruned > 0 && after < before;
    console.log(
      `prune: ${before} rows -> ${after} (removed ${pruned}) -> ${prunePass ? "PASS" : "FAIL"}`
    );

    const pass = seqPass && concPass && prunePass;
    console.log(pass ? "\nPASS - limiter blocks, counts atomically, prunes" : "\nFAIL");
    process.exitCode = pass ? 0 : 1;
  } finally {
    await prisma.rateLimit.deleteMany({ where: { key: { contains: "test-" } } });
    await prisma.$disconnect();
    console.log("test counters cleaned up");
  }
}

main();
