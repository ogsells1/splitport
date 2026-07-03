// frontend/app/api/treasury/streams/route.ts
// Owner-facing CRUD for Superfluid-style payout streams.
//   GET    ?contractAddress=&ownerPrivyId=  – list streams with accrued/claimed totals
//   POST   { ownerPrivyId, contractAddress, total, startAt, endAt }  – open a stream
//   DELETE ?id=&ownerPrivyId=               – cancel an active stream
// The full total is reserved from the treasury upfront. Accrual is computed on
// read (see lib/stream); contributors claim accrued funds from their cabinet.

import { NextResponse } from "next/server";
import { parseUnits, formatUnits } from "viem";
import { prisma } from "@/lib/prisma";
import { getAvailableBalance } from "@/lib/treasuryBalance";
import { accruedAmount } from "@/lib/stream";
import { computeShares, DistributionError } from "@/lib/distribute";
import { requireUser, authErrorResponse } from "@/lib/auth";

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
  let ownerPrivyId: string;
  try {
    ownerPrivyId = await requireUser(request);
  } catch (e) {
    const { error, status } = authErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const contractAddress = searchParams.get("contractAddress");
    if (!contractAddress) {
      return NextResponse.json(
        { error: "contractAddress is required" },
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
  let ownerPrivyId: string;
  try {
    ownerPrivyId = await requireUser(request);
  } catch (e) {
    const { error, status } = authErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }

  try {
    // Streaming is custodial-only; vault (onchain) mode defers to a later phase.
    if (process.env.CUSTODY_MODE === "onchain") {
      return NextResponse.json(
        { error: "Streaming payouts are not yet supported in vault (non-custodial) mode. Use one-off or scheduled payouts instead." },
        { status: 501 }
      );
    }

    const body = await request.json();
    const { contractAddress, total, startAt, endAt, contributorIds } = body;

    if (!contractAddress) {
      return NextResponse.json(
        { error: "contractAddress is required" },
        { status: 400 }
      );
    }
    // PERCENTAGE projects stream a chosen total; FIXED streams the sum of each
    // contributor's fixed amount over the window (total is derived, not required).
    let totalUsdcInput: bigint | undefined;
    if (total != null && total !== "") {
      const totalNum = Number(total);
      if (!Number.isFinite(totalNum) || totalNum <= 0) {
        return NextResponse.json({ error: "total must be greater than 0" }, { status: 400 });
      }
      totalUsdcInput = parseUnits(String(totalNum), 6);
    }
    const now = new Date();
    // A date-only picker yields midnight, so a start "today" would already be
    // partway accrued. Clamp any past/empty start to now so streams begin at 0%.
    let start = startAt ? new Date(startAt) : now;
    const end = new Date(endAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid start or end date" }, { status: 400 });
    }
    if (start.getTime() < now.getTime()) start = now;
    if (end.getTime() <= start.getTime()) {
      return NextResponse.json({ error: "End date must be after the start date" }, { status: 400 });
    }

    const owned = await ownedProject(contractAddress, ownerPrivyId);
    if ("error" in owned) {
      return NextResponse.json({ error: owned.error }, { status: owned.status });
    }
    const { project } = owned;

    let shares, committed: bigint;
    try {
      const computed = computeShares(project.splitMode, project.contributors, {
        amountUsdc: totalUsdcInput,
        contributorIds: Array.isArray(contributorIds) ? contributorIds : undefined,
      });
      shares = computed.shares;
      committed = computed.total;
    } catch (e: any) {
      if (e instanceof DistributionError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const available = await getAvailableBalance(project.ownerId);
    if (committed > available) {
      return NextResponse.json(
        { error: `Insufficient treasury balance. Available: ${formatUnits(available, 6)} USDC.` },
        { status: 400 }
      );
    }

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
  let ownerPrivyId: string;
  try {
    ownerPrivyId = await requireUser(request);
  } catch (e) {
    const { error, status } = authErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
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
