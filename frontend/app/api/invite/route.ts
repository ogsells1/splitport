// frontend/app/api/invite/route.ts
// POST /api/invite — owner creates a pending contributor slot (role+percentage, no wallet)
// and gets back an inviteToken to share as a claim link.

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { parseUnits } from "viem";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ownerPrivyId, contractAddress, role, percentage, amount } = body;

    if (!ownerPrivyId || !contractAddress || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { contractAddress },
      include: { owner: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (project.owner.privyId !== ownerPrivyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Share field depends on the project's split mode.
    let shareFields: { percentage: number; fixedAmount: bigint | null };
    if (project.splitMode === "FIXED") {
      if (typeof amount !== "number" || amount <= 0) {
        return NextResponse.json({ error: "A fixed amount greater than 0 is required" }, { status: 400 });
      }
      shareFields = { percentage: 0, fixedAmount: parseUnits(String(amount), 6) };
    } else {
      if (typeof percentage !== "number") {
        return NextResponse.json({ error: "A percentage is required" }, { status: 400 });
      }
      shareFields = { percentage, fixedAmount: null };
    }

    const inviteToken = randomBytes(24).toString("base64url");

    const contributor = await prisma.contributor.create({
      data: {
        projectId: project.id,
        ...shareFields,
        role: role.trim(),
        wallet: null,
        status: "PENDING",
        inviteToken,
      },
    });

    return NextResponse.json({
      id: contributor.id,
      inviteToken,
      inviteUrl: `/invite/${inviteToken}`,
    });
  } catch (error) {
    console.error("[POST /api/invite]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
