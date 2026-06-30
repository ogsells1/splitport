// frontend/app/api/treasury/streams/route.ts
// Owner-facing CRUD for Superfluid-style payout streams.
//   GET    ?contractAddress=&ownerPrivyId=  — list streams with accrued/claimed totals
//   POST   { ownerPrivyId, contractAddress, total, startAt, endAt }  — open a stream
//   DELETE ?id=&ownerPrivyId=               — cancel an active stream
// The full total is reserved from the treasury upfront. Accrual is computed on
// read (see lib/stream); contributors claim accrued funds from their cabinet.

import { NextResponse } from "next/server";
import { parseUnits, formatUnits } from "viem";
import { prisma } from "@/lib/prisma";
import { getAvailableBalance } from "@/lib/treasuryBalance";
import { accruedAmount } from "@/lib/stream";

async function ownedProject(contractAddress: string, ownerPrivyId: string) {
  const project = await prisma.project.findUnique({
    where: { contractAddress },
    include: { owner: true, contributors: { where: { active: true } } },
  });
  if (!project) return { error: "Project not found", status: 404 as const };
  if (project.owner.privyId !== ownerPrivyId) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { project };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const contractAddress = searchParams.get("contractAddress");
    const ownerPrivyId = searchParams.get("ownerPrivyId");
    if (!contractAddress || !ownerPrivyId) {
      return NextResponse.json(
        { error: "contractAddress and ownerPrivyId are required" },
        { status: 400 }
      );
    }

    const owned = await ownedProject(contractAddress, ownerPrivyId);
    if ("error" in owned) {
      return NextResponse.json({ error: owned.error }, { status: owned.status });
    }

    const streams = await prisma.payoutStream.findMany({
      where: { projectId: owned.project.id },
      orderBy: { createdAt: "desc" },
      include: { shares: { select: { amount: true, claimedAmount: true } } },
    });

    const now = new Date();
    return NextResponse.json({
      streams: streams.map((s) => {
        const accrued = s.shares.reduce(
          (a, sh) => a + accruedAmount(sh.amount, s.startAt, s.endAt, now),
          0n
        );
        const claimed = s.shares.reduce((a, sh) => a + sh.claimedAmount, 0n);
        return {
          id: s.id,
          total: s.total.toString(),
          accrued: accrued.toString(),
          claimed: claimed.toString(),
          startAt: s.startAt,
          endAt: s.endAt,
          status: s.status,
          canceledAt: s.canceledAt,
          createdAt: s.createdAt,
        };
      }),
    });
  } catch (error) {
    console.error("[GET /api/treasury/streams]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ownerPrivyId, contractAddress, total, startAt, endAt } = body;

    if (!ownerPrivyId || !contractAddress) {
      return NextResponse.json(
        { error: "ownerPrivyId and contractAddress are required" },
        { status: 400 }
      );
    }
    const totalNum = Number(total);
    if (!Number.isFinite(totalNum) || totalNum <= 0) {
      return NextResponse.json({ error: "total must be greater than 0" }, { status: 400 });
    }
    const start = startAt ? new Date(startAt) : new Date();
    const end = new Date(endAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid start or end date" }, { status: 400 });
    }
    if (end.getTime() <= start.getTime()) {
      return NextResponse.json({ error: "End date must be after the start date" }, { status: 400 });
    }

    const owned = await ownedProject(contractAddress, ownerPrivyId);
    if ("error" in owned) {
      return NextResponse.json({ error: owned.error }, { status: owned.status });
    }
    const { project } = owned;

    const contributors = project.contributors;
    if (contributors.length === 0) {
      return NextResponse.json({ error: "Project has no contributors" }, { status: 400 });
    }
    const totalBps = contributors.reduce((s, c) => s + c.percentage, 0);
    if (totalBps !== 10000) {
      return NextResponse.json(
        { error: `Contributor percentages must sum to 100% (got ${totalBps / 100}%).` },
        { status: 400 }
      );
    }

    const totalUsdc = parseUnits(String(totalNum), 6);
    const available = await getAvailableBalance(project.ownerId);
    if (totalUsdc > available) {
      return NextResponse.json(
        { error: `Insufficient treasury balance. Available: ${formatUnits(available, 6)} USDC.` },
        { status: 400 }
      );
    }

    // Split by basis points; dust (remainder) stays in the treasury.
    const shares = contributors.map((c) => ({
      contributorId: c.id,
      wallet: c.wallet ? c.wallet.toLowerCase() : null,
      amount: (totalUsdc * BigInt(c.percentage)) / 10000n,
    }));
    const committed = shares.reduce((s, x) => s + x.amount, 0n);

    const stream = await prisma.$transaction(async (tx) => {
      const created = await tx.payoutStream.create({
        data: { projectId: project.id, total: committed, startAt: start, endAt: end },
      });
      await tx.streamShare.createMany({
        data: shares.map((s) => ({
          streamId: created.id,
          contributorId: s.contributorId,
          wallet: s.wallet,
          amount: s.amount,
        })),
      });
      return created;
    });

    return NextResponse.json({
      stream: {
        id: stream.id,
        total: committed.toString(),
        startAt: stream.startAt,
        endAt: stream.endAt,
        status: stream.status,
      },
    });
  } catch (error: any) {
    console.error("[POST /api/treasury/streams]", error);
    return NextResponse.json({ error: error?.message ?? "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const ownerPrivyId = searchParams.get("ownerPrivyId");
    if (!id || !ownerPrivyId) {
      return NextResponse.json({ error: "id and ownerPrivyId are required" }, { status: 400 });
    }

    const stream = await prisma.payoutStream.findUnique({
      where: { id },
      include: { project: { include: { owner: true } } },
    });
    if (!stream) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (stream.project.owner.privyId !== ownerPrivyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (stream.status !== "ACTIVE") {
      return NextResponse.json({ error: "Stream is already canceled" }, { status: 400 });
    }

    // Cancel: accrual stops, the unclaimed remainder is released back to the
    // treasury (handled by getAvailableBalance treating CANCELED as claimed-only).
    await prisma.payoutStream.update({
      where: { id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/treasury/streams]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
