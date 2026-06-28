// frontend/app/api/invite/[token]/route.ts
// GET    /api/invite/[token] — public, returns slot info for the invite-claim page
// POST   /api/invite/[token] — participant claims the slot with their own wallet
// DELETE /api/invite/[token] — owner revokes a not-yet-claimed invite

import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: { token: string } }
) {
  try {
    const { token } = params;

    const contributor = await prisma.contributor.findUnique({
      where: { inviteToken: token },
      include: { project: { select: { name: true, contractAddress: true } } },
    });

    if (!contributor) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    return NextResponse.json({
      projectName: contributor.project.name,
      role: contributor.role,
      percentage: contributor.percentage,
      status: contributor.status,
    });
  } catch (error) {
    console.error("[GET /api/invite/[token]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  try {
    const { token } = params;
    const body = await request.json();
    const { wallet, privyId } = body;

    if (!wallet || !isAddress(wallet) || !privyId) {
      return NextResponse.json({ error: "Valid wallet and privyId are required" }, { status: 400 });
    }

    const contributor = await prisma.contributor.findUnique({
      where: { inviteToken: token },
    });

    if (!contributor) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }
    if (contributor.status === "CLAIMED") {
      return NextResponse.json({ error: "Invite already claimed" }, { status: 409 });
    }

    const duplicate = await prisma.contributor.findFirst({
      where: {
        projectId: contributor.projectId,
        wallet: { equals: wallet, mode: "insensitive" },
      },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "This wallet is already a contributor on this project" },
        { status: 409 }
      );
    }

    await prisma.contributor.update({
      where: { id: contributor.id },
      data: {
        wallet,
        status: "CLAIMED",
        claimedByPrivyId: privyId,
      },
    });

    // Reserved payouts created before this invite was claimed now become
    // claimable: attach the linked wallet so they show up in the cabinet.
    await prisma.payout.updateMany({
      where: { contributorId: contributor.id, wallet: null, status: "PENDING" },
      data: { wallet: wallet.toLowerCase() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[POST /api/invite/[token]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { token: string } }
) {
  try {
    const { token } = params;
    const { searchParams } = new URL(request.url);
    const ownerPrivyId = searchParams.get("ownerPrivyId");

    const contributor = await prisma.contributor.findUnique({
      where: { inviteToken: token },
      include: { project: { include: { owner: true } } },
    });

    if (!contributor) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }
    if (!ownerPrivyId || contributor.project.owner.privyId !== ownerPrivyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (contributor.status === "CLAIMED") {
      return NextResponse.json({ error: "Cannot revoke a claimed invite" }, { status: 409 });
    }

    await prisma.contributor.delete({ where: { id: contributor.id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/invite/[token]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
