// frontend/app/api/contributor/route.ts
// PATCH /api/contributor — owner edits a contributor's fixed payout amount
// (FIXED-mode projects only). The split mode itself is immutable; only amounts
// can change after creation.

import { NextResponse } from "next/server";
import { parseUnits } from "viem";
import { prisma } from "@/lib/prisma";
import { requireUser, authErrorResponse } from "@/lib/auth";

export async function PATCH(request: Request) {
  let ownerPrivyId: string;
  try {
    ownerPrivyId = await requireUser(request);
  } catch (e) {
    const { error, status } = authErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }

  try {
    const body = await request.json();
    const { contributorId, amount } = body;

    if (!contributorId) {
      return NextResponse.json(
        { error: "contributorId is required" },
        { status: 400 }
      );
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json({ error: "amount must be greater than 0" }, { status: 400 });
    }

    const contributor = await prisma.contributor.findUnique({
      where: { id: contributorId },
      include: { project: { include: { owner: true } } },
    });
    if (!contributor) {
      return NextResponse.json({ error: "Contributor not found" }, { status: 404 });
    }
    if (contributor.project.owner.privyId !== ownerPrivyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (contributor.project.splitMode !== "FIXED") {
      return NextResponse.json(
        { error: "Fixed amounts apply only to fixed-amount projects." },
        { status: 400 }
      );
    }

    const updated = await prisma.contributor.update({
      where: { id: contributorId },
      data: { fixedAmount: parseUnits(String(amountNum), 6) },
    });

    return NextResponse.json({
      id: updated.id,
      fixedAmount: updated.fixedAmount?.toString() ?? null,
    });
  } catch (error: any) {
    console.error("[PATCH /api/contributor]", error);
    return NextResponse.json({ error: error?.message ?? "Internal server error" }, { status: 500 });
  }
}
