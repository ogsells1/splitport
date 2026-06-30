// frontend/app/api/treasury/payments/route.ts
// Owner-facing CRUD for a project's queue of one-off scheduled payouts. Unlike the
// single recurring PayoutSchedule, a project can have any number of these — each a
// fixed amount distributed once on a future date by the daily cron.
//   GET    ?contractAddress=&ownerPrivyId=  — list (newest first)
//   POST   { ownerPrivyId, contractAddress, amount, runAt }  — queue one
//   DELETE ?id=&ownerPrivyId=               — cancel a PENDING one

import { NextResponse } from "next/server";
import { parseUnits } from "viem";
import { prisma } from "@/lib/prisma";

async function ownedProject(contractAddress: string, ownerPrivyId: string) {
  const project = await prisma.project.findUnique({
    where: { contractAddress },
    include: { owner: true },
  });
  if (!project) return { error: "Project not found", status: 404 as const };
  if (project.owner.privyId !== ownerPrivyId) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { project };
}

function serialize(p: {
  id: string;
  amount: bigint;
  runAt: Date;
  status: string;
  ranAt: Date | null;
  distributionId: string | null;
}) {
  return {
    id: p.id,
    amount: p.amount.toString(),
    runAt: p.runAt,
    status: p.status,
    ranAt: p.ranAt,
    distributionId: p.distributionId,
  };
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

    const payments = await prisma.scheduledPayout.findMany({
      where: { projectId: owned.project.id },
      orderBy: { runAt: "asc" },
    });
    return NextResponse.json({ payments: payments.map(serialize) });
  } catch (error) {
    console.error("[GET /api/treasury/payments]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ownerPrivyId, contractAddress, amount, runAt } = body;

    if (!ownerPrivyId || !contractAddress) {
      return NextResponse.json(
        { error: "ownerPrivyId and contractAddress are required" },
        { status: 400 }
      );
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json({ error: "amount must be greater than 0" }, { status: 400 });
    }
    if (!runAt) {
      return NextResponse.json({ error: "A payout date is required" }, { status: 400 });
    }
    const when = new Date(runAt);
    if (isNaN(when.getTime())) {
      return NextResponse.json({ error: "runAt is not a valid date" }, { status: 400 });
    }

    const owned = await ownedProject(contractAddress, ownerPrivyId);
    if ("error" in owned) {
      return NextResponse.json({ error: owned.error }, { status: owned.status });
    }

    const payment = await prisma.scheduledPayout.create({
      data: {
        projectId: owned.project.id,
        amount: parseUnits(String(amountNum), 6),
        runAt: when,
      },
    });
    return NextResponse.json({ payment: serialize(payment) });
  } catch (error: any) {
    console.error("[POST /api/treasury/payments]", error);
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

    const payment = await prisma.scheduledPayout.findUnique({
      where: { id },
      include: { project: { include: { owner: true } } },
    });
    if (!payment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (payment.project.owner.privyId !== ownerPrivyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (payment.status !== "PENDING") {
      return NextResponse.json(
        { error: "Only pending payouts can be canceled" },
        { status: 400 }
      );
    }

    await prisma.scheduledPayout.update({
      where: { id },
      data: { status: "CANCELED" },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/treasury/payments]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
