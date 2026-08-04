// Concurrency proof for the claim lock. Creates throwaway fixtures, fires N
// parallel acquireClaimLock() calls at the same wallet, asserts exactly one run
// wins the payout, then deletes everything it created.
//
// Run: npx tsx scripts/race-test.ts

import path from "path";
import dotenv from "dotenv";

// Static imports are hoisted, so the env must be loaded before lib/prisma is
// pulled in - it builds its connection pool at module load.
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const PARALLEL = 8;
const WALLET = `0xrace${Date.now().toString(16).padStart(36, "0")}`;

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { acquireClaimLock, releaseClaimLock } = await import("@/lib/claimLock");

  const created: { userId?: string; projectId?: string; distributionId?: string } = {};

  try {
    const user = await prisma.user.create({ data: { privyId: `race-test-${Date.now()}` } });
    created.userId = user.id;

    const project = await prisma.project.create({
      data: {
        name: "race-test",
        contractAddress: `0xracetest${Date.now()}`,
        usdcAddress: "0x0000000000000000000000000000000000000000",
        ownerId: user.id,
      },
    });
    created.projectId = project.id;

    const distribution = await prisma.distribution.create({
      data: { projectId: project.id, total: 500_000_000n },
    });
    created.distributionId = distribution.id;

    await prisma.payout.create({
      data: {
        distributionId: distribution.id,
        projectId: project.id,
        wallet: WALLET,
        amount: 500_000_000n, // 500 USDC
      },
    });

    console.log(`fixtures ready: 1 PENDING payout of 500 USDC for ${WALLET}`);

    // Control: the pre-fix read ("findMany, then transfer"). Proves this test can
    // actually detect the bug rather than passing vacuously.
    const control = await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        prisma.payout.findMany({ where: { wallet: WALLET, status: "PENDING" } })
      )
    );
    const controlWinners = control.filter((rows) => rows.length > 0).length;
    const controlTotal = control.reduce(
      (s, rows) => s + rows.reduce((a, p) => a + p.amount, 0n),
      0n
    );
    console.log(
      `\ncontrol (old read-then-transfer): ${controlWinners}/${PARALLEL} runs would transfer, ` +
        `${Number(controlTotal) / 1e6} USDC total on a 500 USDC debt`
    );
    const controlDetectsBug = controlWinners > 1;
    console.log(
      controlDetectsBug
        ? "  -> test is meaningful: old path double-spends here"
        : "  -> WARNING: control did not reproduce the bug, test may be vacuous"
    );

    console.log(`\nfiring ${PARALLEL} parallel claim runs (with lock)...\n`);

    const runs = await Promise.all(
      Array.from({ length: PARALLEL }, async (_, i) => {
        const lock = await acquireClaimLock(WALLET);
        const won = lock.payouts.reduce((s, p) => s + p.amount, 0n);
        return { i, lockId: lock.lockId, count: lock.payouts.length, won };
      })
    );

    for (const r of runs) {
      console.log(`  run #${r.i}: ${r.count > 0 ? `WON ${Number(r.won) / 1e6} USDC` : "won nothing"}`);
    }

    const winners = runs.filter((r) => r.count > 0);
    const totalWon = runs.reduce((s, r) => s + r.won, 0n);

    console.log(`\nwinners: ${winners.length} (expected 1)`);
    console.log(`total claimed across all runs: ${Number(totalWon) / 1e6} USDC (expected 500)`);

    const noDoubleSpend = winners.length === 1 && totalWon === 500_000_000n;
    console.log(noDoubleSpend ? "\nPASS - no double-spend" : "\nFAIL - debt handed out more than once");

    // Release everything, then confirm the row is reusable for a later retry.
    for (const r of runs) await releaseClaimLock(r.lockId);
    const after = await prisma.payout.findFirst({ where: { wallet: WALLET } });
    const released = after?.status === "PENDING" && after?.claimLockId === null;
    console.log(
      `after release: status=${after?.status}, lock=${after?.claimLockId ?? "null"} ` +
        `(expected PENDING/null) -> ${released ? "PASS" : "FAIL"}`
    );

    process.exitCode = controlDetectsBug && noDoubleSpend && released ? 0 : 1;
  } finally {
    await prisma.payout.deleteMany({ where: { wallet: WALLET } });
    if (created.distributionId)
      await prisma.distribution.deleteMany({ where: { id: created.distributionId } });
    if (created.projectId) await prisma.project.deleteMany({ where: { id: created.projectId } });
    if (created.userId) await prisma.user.deleteMany({ where: { id: created.userId } });
    await prisma.$disconnect();
    console.log("fixtures cleaned up");
  }
}

main();
