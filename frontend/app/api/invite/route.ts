// frontend/app/api/invite/route.ts
// POST /api/invite - owner adds a contributor to a project. Two ways:
//   - by invite link: no wallet → creates a PENDING slot + inviteToken to share.
//   - by wallet: a valid address → creates a CLAIMED contributor straight away.

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { parseUnits, isAddress } from "viem";
import { prisma } from "@/lib/prisma";
import { requireUser, authErrorResponse } from "@/lib/auth";

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
    const { contractAddress, role, percentage, amount, wallet } = body;

    if (!contractAddress || !role) {
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

    // Add directly by wallet → CLAIMED contributor, no invite link.
    if (wallet != null && wallet !== "") {
      if (!isAddress(wallet)) {
        return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
      }
      const walletLc = wallet.toLowerCase();
      const duplicate = await prisma.contributor.findFirst({
        where: { projectId: project.id, wallet: { equals: walletLc, mode: "insensitive" } },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "This wallet is already a contributor on this project" },
          { status: 409 }
        );
      }
      const contributor = await prisma.contributor.create({
        data: {
          projectId: project.id,
          ...shareFields,
          role: role.trim(),
          wallet: walletLc,
          status: "CLAIMED",
        },
      });
      return NextResponse.json({ id: contributor.id, wallet: walletLc, status: "CLAIMED" });
    }

    // Otherwise, generate an invite link (PENDING slot).
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
