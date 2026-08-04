// End-to-end proof that two parallel claims cannot pay one debt twice.
//
// Unlike scripts/race-test.ts (which exercises the lock alone, no chain), this
// runs the real custodial settlement against Arc testnet: real executor wallet,
// real USDC transfer, real receipt. It fires two concurrent settleClaim() calls
// at one payout and checks that the destination received it exactly once.
//
// Costs a real testnet transfer (PAYOUT_USDC, unrecoverable) plus gas.
//
// Run: npx tsx scripts/e2e-claim-race.ts

import path from "path";
import dotenv from "dotenv";

// Loaded before lib/prisma and lib/executor are imported - both read env at
// module load. Static imports would hoist above this.
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const PAYOUT_RAW = 100_000n; // 0.10 USDC, ~80x the observed transfer fee

async function main() {
  const { formatUnits } = await import("viem");
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
  const { prisma } = await import("@/lib/prisma");
  const { getExecutor } = await import("@/lib/executor");
  const { USDC_ADDRESS, USDC_ABI } = await import("@/lib/contract");
  const { CustodialSettlement } = await import("@/lib/settlement/custodial");

  const executor = getExecutor();
  if (!executor) throw new Error("EXECUTOR_PRIVATE_KEY missing - cannot run the on-chain test");

  // A fresh address so its balance is provably zero before the run: whatever it
  // holds afterwards came from this test and nothing else.
  const destination = privateKeyToAccount(generatePrivateKey()).address;
  const destinationLc = destination.toLowerCase();

  const balanceOf = (who: string) =>
    executor.publicClient.readContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [who as `0x${string}`],
    }) as Promise<bigint>;

  const created: { userId?: string; projectId?: string; distributionId?: string } = {};

  try {
    const user = await prisma.user.create({ data: { privyId: `e2e-race-${Date.now()}` } });
    created.userId = user.id;

    const project = await prisma.project.create({
      data: {
        name: "e2e-claim-race",
        contractAddress: `0xe2eracetest${Date.now()}`,
        usdcAddress: USDC_ADDRESS,
        ownerId: user.id,
      },
    });
    created.projectId = project.id;

    const distribution = await prisma.distribution.create({
      data: { projectId: project.id, total: PAYOUT_RAW },
    });
    created.distributionId = distribution.id;

    await prisma.payout.create({
      data: {
        distributionId: distribution.id,
        projectId: project.id,
        wallet: destinationLc,
        amount: PAYOUT_RAW,
      },
    });

    const destBefore = await balanceOf(destination);
    const execBefore = await balanceOf(executor.account.address);

    console.log(`destination:      ${destination}`);
    console.log(`  balance before: ${formatUnits(destBefore, 6)} USDC (expected 0)`);
    console.log(`executor:         ${executor.account.address}`);
    console.log(`  balance before: ${formatUnits(execBefore, 6)} USDC`);
    console.log(`debt:             ${formatUnits(PAYOUT_RAW, 6)} USDC (1 PENDING payout)`);
    console.log(`\nfiring 2 concurrent settleClaim() calls against Arc testnet...\n`);

    const settlement = new CustodialSettlement();
    const results = await Promise.allSettled([
      settlement.settleClaim(destination),
      settlement.settleClaim(destination),
    ]);

    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        console.log(
          `  call #${i}: SETTLED gross=${formatUnits(r.value.gross, 6)} ` +
            `fee=${formatUnits(r.value.fee, 6)} net=${formatUnits(r.value.net, 6)} tx=${r.value.txHash}`
        );
      } else {
        console.log(`  call #${i}: refused - ${r.reason?.message ?? r.reason}`);
      }
    });

    const settled = results.filter((r) => r.status === "fulfilled");
    const expectedNet = settled.length
      ? (settled[0] as PromiseFulfilledResult<{ net: bigint }>).value.net
      : 0n;

    // Give the node a moment to surface the post-receipt state.
    await new Promise((r) => setTimeout(r, 3000));
    const destAfter = await balanceOf(destination);
    const rows = await prisma.payout.findMany({ where: { wallet: destinationLc } });

    console.log(`\n--- results ---`);

    const oneSettled = settled.length === 1;
    console.log(
      `settled calls:        ${settled.length} (expected 1) -> ${oneSettled ? "PASS" : "FAIL"}`
    );

    const paidOnce = destAfter === expectedNet;
    console.log(
      `destination received: ${formatUnits(destAfter, 6)} USDC ` +
        `(expected ${formatUnits(expectedNet, 6)}, double-spend would be ` +
        `${formatUnits(expectedNet * 2n, 6)}) -> ${paidOnce ? "PASS" : "FAIL"}`
    );

    const dbConsistent =
      rows.length === 1 && rows[0].status === "CLAIMED" && rows[0].claimLockId === null;
    console.log(
      `db row:               status=${rows[0]?.status} lock=${rows[0]?.claimLockId ?? "null"} ` +
        `tx=${rows[0]?.txHash ?? "none"} -> ${dbConsistent ? "PASS" : "FAIL"}`
    );

    const pass = oneSettled && paidOnce && dbConsistent;
    console.log(
      pass
        ? "\nPASS - one debt, one transfer, one CLAIMED row"
        : "\nFAIL - see mismatches above"
    );
    process.exitCode = pass ? 0 : 1;
  } finally {
    await prisma.payout.deleteMany({ where: { wallet: destinationLc } });
    if (created.distributionId)
      await prisma.distribution.deleteMany({ where: { id: created.distributionId } });
    if (created.projectId) await prisma.project.deleteMany({ where: { id: created.projectId } });
    if (created.userId) await prisma.user.deleteMany({ where: { id: created.userId } });
    await prisma.$disconnect();
    console.log("fixtures cleaned up");
  }
}

main();
