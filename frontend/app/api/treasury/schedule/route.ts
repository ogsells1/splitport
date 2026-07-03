// frontend/app/api/treasury/schedule/route.ts
// Owner-facing CRUD for a project's automatic-payout schedule.
//   GET    ?contractAddress=&ownerPrivyId=  – current schedule (or null)
//   POST   { ownerPrivyId, contractAddress, frequency, amount, nextRunAt? }
//          – upsert the schedule (one per project)
//   DELETE ?contractAddress=&ownerPrivyId=  – turn auto-payouts off
// Custodial, no on-chain tx. The daily cron at /api/treasury/schedule/run
// executes due schedules.

import { NextResponse } from "next/server";
import { parseUnits } from "viem";
import { prisma } from "@/lib/prisma";
import { defaultNextRun, type Frequency } from "@/lib/schedule";
import { requireUser, authErrorResponse } from "@/lib/auth";

const FREQUENCIES: Frequency[] = ["WEEKLY", "MONTHLY", "CUSTOM"];

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

// In FIXED projects the per-run total is the sum of each contributor's fixed
// amount; in PERCENTAGE projects the owner supplies the amount.
function fixedTotal(contributors: { fixedAmount: bigint | null }[]): bigint {
  return contributors.reduce((s, c) => s + (c.fixedAmount ?? 0n), 0n);
}

function serialize(s: {
  id: string;
  frequency: string;
  amount: bigint;
  nextRunAt: Date;
  active: boolean;
  lastRunAt: Date | null;
}) {
  return {
    id: s.id,
    frequency: s.frequency,
    amount: s.amount.toString(),
    nextRunAt: s.nextRunAt,
    active: s.active,
    lastRunAt: s.lastRunAt,
  };
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

    const schedule = await prisma.payoutSchedule.findUnique({
      where: { projectId: owned.project.id },
    });
    return NextResponse.json({ schedule: schedule ? serialize(schedule) : null });
  } catch (error) {
    console.error("[GET /api/treasury/schedule]", error);
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
    const body = await request.json();
    const { contractAddress, frequency, amount, nextRunAt } = body;

    if (!contractAddress || !FREQUENCIES.includes(frequency)) {
      return NextResponse.json(
        { error: "contractAddress and a valid frequency are required" },
        { status: 400 }
      );
    }
    // CUSTOM requires an explicit date; WEEKLY/MONTHLY default to one interval out.
    let runAt: Date;
    if (nextRunAt) {
      runAt = new Date(nextRunAt);
      if (isNaN(runAt.getTime())) {
        return NextResponse.json({ error: "nextRunAt is not a valid date" }, { status: 400 });
      }
    } else if (frequency === "CUSTOM") {
      return NextResponse.json(
        { error: "A next payout date is required for a custom schedule" },
        { status: 400 }
      );
    } else {
      runAt = defaultNextRun(frequency as Frequency);
    }

    const owned = await ownedProject(contractAddress, ownerPrivyId);
    if ("error" in owned) {
      return NextResponse.json({ error: owned.error }, { status: owned.status });
    }

    // FIXED: per-run total is derived from fixed amounts (runtime uses them too).
    // PERCENTAGE: owner supplies the amount.
    let amountUsdc: bigint;
    if (owned.project.splitMode === "FIXED") {
      amountUsdc = fixedTotal(owned.project.contributors);
      if (amountUsdc <= 0n) {
        return NextResponse.json(
          { error: "Set fixed amounts for contributors first." },
          { status: 400 }
        );
      }
    } else {
      const amountNum = Number(amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        return NextResponse.json({ error: "amount must be greater than 0" }, { status: 400 });
      }
      amountUsdc = parseUnits(String(amountNum), 6);
    }
    const schedule = await prisma.payoutSchedule.upsert({
      where: { projectId: owned.project.id },
      create: {
        projectId: owned.project.id,
        frequency,
        amount: amountUsdc,
        nextRunAt: runAt,
        active: true,
      },
      update: {
        frequency,
        amount: amountUsdc,
        nextRunAt: runAt,
        active: true,
      },
    });

    return NextResponse.json({ schedule: serialize(schedule) });
  } catch (error: any) {
    console.error("[POST /api/treasury/schedule]", error);
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

    await prisma.payoutSchedule.deleteMany({ where: { projectId: owned.project.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/treasury/schedule]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
