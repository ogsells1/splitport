// frontend/app/api/treasury/distribute/route.ts
// POST /api/treasury/distribute — owner splits an amount from the treasury across
// a project's contributors by basis points, creating claimable Payouts. Fully
// custodial: no on-chain tx, the owner never signs anything. Contributors later
// claim their share from their cabinet.

import { NextResponse } from "next/server";
import { parseUnits, formatUnits } from "viem";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ownerPrivyId, contractAddress, amount } = body;

    const amountNum = Number(amount);
    if (!ownerPrivyId || !contractAddress || !Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { error: "ownerPrivyId, contractAddress and a positive amount are required" },
        { status: 400 }
      );
    }

    const amountUsdc = parseUnits(String(amountNum), 6);

    const project = await prisma.project.findUnique({
      where: { contractAddress },
      include: { owner: true, contributors: { where: { active: true } } },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (project.owner.privyId !== ownerPrivyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const contributors = project.contributors;
    if (contributors.length === 0) {
      return NextResponse.json({ error: "Project has no contributors" }, { status: 400 });
    }
    const pending = contributors.filter((c) => c.status === "PENDING" || !c.wallet);
    if (pending.length > 0) {
      return NextResponse.json(
        { error: "All contributors must claim their invite (link a wallet) before distributing." },
        { status: 400 }
      );
    }
    const totalBps = contributors.reduce((s, c) => s + c.percentage, 0);
    if (totalBps !== 10000) {
      return NextResponse.json(
        { error: `Contributor percentages must sum to 100% (got ${totalBps / 100}%).` },
        { status: 400 }
      );
    }

    // Treasury balance: confirmed deposits − already distributed.
    const owner = project.owner;
    const [deposits, distributions] = await Promise.all([
      prisma.treasuryDeposit.findMany({ where: { userId: owner.id, status: "CONFIRMED" } }),
      prisma.distribution.findMany({
        where: { project: { ownerId: owner.id } },
      }),
    ]);
    const deposited = deposits.reduce((s, d) => s + d.amount, 0n);
    const distributed = distributions.reduce((s, d) => s + d.total, 0n);
    const available = deposited - distributed;

    if (amountUsdc > available) {
      return NextResponse.json(
        { error: `Insufficient treasury balance. Available: ${formatUnits(available, 6)} USDC.` },
        { status: 400 }
      );
    }

    // Split by basis points. Remainder (dust) stays in the treasury.
    const shares = contributors.map((c) => ({
      wallet: c.wallet!.toLowerCase(),
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
          wallet: s.wallet,
          amount: s.amount,
        })),
      });
      return distribution;
    });

    return NextResponse.json({
      distributionId: result.id,
      distributed: distributedSum.toString(),
      payouts: shares.length,
    });
  } catch (error: any) {
    console.error("[POST /api/treasury/distribute]", error);
    return NextResponse.json({ error: error?.message ?? "Internal server error" }, { status: 500 });
  }
}
