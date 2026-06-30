// frontend/app/api/treasury/distribute/route.ts
// POST /api/treasury/distribute — owner splits an amount from the treasury across
// a project's contributors by basis points, creating claimable Payouts. Fully
// custodial: no on-chain tx, the owner never signs anything. Contributors later
// claim their share from their cabinet. Shares the core logic with the scheduled
// auto-payout cron via lib/distribute.

import { NextResponse } from "next/server";
import { parseUnits } from "viem";
import { runDistribution, DistributionError } from "@/lib/distribute";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ownerPrivyId, contractAddress, amount, contributorIds } = body;

    if (!ownerPrivyId || !contractAddress) {
      return NextResponse.json(
        { error: "ownerPrivyId and contractAddress are required" },
        { status: 400 }
      );
    }

    // PERCENTAGE projects need a positive amount; FIXED projects derive the total
    // from each contributor's fixed amount (amount is ignored), so it's optional.
    let amountUsdc: bigint | undefined;
    if (amount != null && amount !== "") {
      const amountNum = Number(amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        return NextResponse.json({ error: "amount must be greater than 0" }, { status: 400 });
      }
      amountUsdc = parseUnits(String(amountNum), 6);
    }

    const result = await runDistribution({
      contractAddress,
      amountUsdc,
      contributorIds: Array.isArray(contributorIds) ? contributorIds : undefined,
      ownerPrivyId,
    });

    return NextResponse.json({
      distributionId: result.distributionId,
      distributed: result.distributed.toString(),
      payouts: result.payouts,
    });
  } catch (error: any) {
    if (error instanceof DistributionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[POST /api/treasury/distribute]", error);
    return NextResponse.json({ error: error?.message ?? "Internal server error" }, { status: 500 });
  }
}
