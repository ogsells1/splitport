// frontend/app/api/invite/route.ts
// POST /api/invite — owner creates a pending contributor slot (role+percentage, no wallet)
// and gets back an inviteToken to share as a claim link.

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ownerPrivyId, contractAddress, role, percentage } = body;

    if (!ownerPrivyId || !contractAddress || !role || typeof percentage !== "number") {
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

    const inviteToken = randomBytes(24).toString("base64url");

    const contributor = await prisma.contributor.create({
      data: {
        projectId: project.id,
        percentage,
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
