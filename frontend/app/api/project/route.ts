// frontend/app/api/project/route.ts
// GET  /api/project?contractAddress=0x...   – проект + участники
// POST /api/project                          – создать/обновить проект (вызывается после deploy)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, authErrorResponse } from "@/lib/auth";

const DEFAULT_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const DEFAULT_CHAIN_ID = 5042002;

export async function GET(request: Request) {
  let requesterPrivyId: string;
  try {
    requesterPrivyId = await requireUser(request);
  } catch (e) {
    const { error, status } = authErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const contractAddress = searchParams.get("contractAddress");

    if (!contractAddress) {
      return NextResponse.json({ error: "contractAddress is required" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { contractAddress },
      include: {
        owner: { select: { privyId: true } },
        contributors: {
          where: { active: true },
          orderBy: { percentage: "desc" },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (project.owner.privyId !== requesterPrivyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      id: project.id,
      name: project.name,
      contractAddress: project.contractAddress,
      chainId: project.chainId,
      splitMode: project.splitMode,
      createdAt: project.createdAt,
      contributors: project.contributors.map((c: typeof project.contributors[number]) => ({
        id: c.id,
        wallet: c.wallet,
        percentage: c.percentage,
        fixedAmount: c.fixedAmount != null ? c.fixedAmount.toString() : null,
        role: c.role,
        totalPaid: c.totalPaid.toString(),
        status: c.status,
        inviteToken: c.status === "PENDING" ? c.inviteToken : undefined,
      })),
    });
  } catch (error) {
    console.error("[GET /api/project]", error);
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
    const { name, contractAddress, usdcAddress, deployBlock, contributors } = body;

    if (!contractAddress || !contributors?.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const totalBps = contributors.reduce((s: number, c: any) => s + c.percentage, 0);
    if (totalBps !== 10000) {
      return NextResponse.json({ error: "Contributors percentages must sum to 10000" }, { status: 400 });
    }

    // If the project already exists, only its owner may update it.
    const existing = await prisma.project.findUnique({
      where: { contractAddress },
      include: { owner: { select: { privyId: true } } },
    });
    if (existing && existing.owner.privyId !== ownerPrivyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const project = await prisma.project.upsert({
      where: { contractAddress },
      update: {
        name: name ?? "SplitPort Project",
        deployBlock: deployBlock ? BigInt(deployBlock) : undefined,
      },
      create: {
        name: name ?? "SplitPort Project",
        contractAddress,
        usdcAddress: usdcAddress ?? DEFAULT_USDC_ADDRESS,
        chainId: DEFAULT_CHAIN_ID,
        deployBlock: deployBlock ? BigInt(deployBlock) : null,
        owner: {
          connectOrCreate: {
            where: { privyId: ownerPrivyId },
            create: { privyId: ownerPrivyId },
          },
        },
      },
    });

    // Пересоздать contributors, отражающих on-chain состояние.
    // Pending инвайты (ещё не привязан кошелёк) не на цепочке – их не трогаем.
    await prisma.contributor.deleteMany({
      where: { projectId: project.id, status: "CLAIMED" },
    });
    await prisma.contributor.createMany({
      data: contributors.map((c: any) => ({
        projectId: project.id,
        wallet: c.wallet,
        percentage: c.percentage,
        role: c.role,
        status: "CLAIMED",
      })),
    });

    return NextResponse.json({ success: true, projectId: project.id });
  } catch (error) {
    console.error("[POST /api/project]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
