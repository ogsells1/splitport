// frontend/app/api/project/route.ts
// GET /api/project — возвращает проект + участников

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const CONTRACT_ADDRESS = "0x2DB3dbDA6C5F5CfF3234CDBadD049D90412c1774";

export async function GET() {
  try {
    const project = await prisma.project.findUnique({
      where: { contractAddress: CONTRACT_ADDRESS },
      include: {
        contributors: {
          where: { active: true },
          orderBy: { percentage: "desc" },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: project.id,
      name: project.name,
      contractAddress: project.contractAddress,
      chainId: project.chainId,
      createdAt: project.createdAt,
      contributors: project.contributors.map((c: typeof project.contributors[number]) => ({
        id: c.id,
        wallet: c.wallet,
        percentage: c.percentage,
        role: c.role,
        totalPaid: c.totalPaid.toString(),
      })),
    });
  } catch (error) {
    console.error("[GET /api/project]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // POST /api/project — создать/обновить проект (вызывается после deploy)
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

    // Upsert project
    const project = await prisma.project.upsert({
      where: { contractAddress },
      update: {
        name: name ?? "BYN Split Pay",
        deployBlock: deployBlock ? BigInt(deployBlock) : undefined,
      },
      create: {
        name: name ?? "BYN Split Pay",
        contractAddress,
        usdcAddress: usdcAddress ?? "0x3600000000000000000000000000000000000000",
        chainId: 5042002,
        deployBlock: deployBlock ? BigInt(deployBlock) : null,
        // ownerId нужен — для MVP используем системный user
        owner: {
          connectOrCreate: {
            where: { privyId: "system" },
            create: { privyId: "system" },
          },
        },
      },
    });

    // Пересоздать contributors
    await prisma.contributor.deleteMany({ where: { projectId: project.id } });
    await prisma.contributor.createMany({
      data: contributors.map((c: any) => ({
        projectId: project.id,
        wallet: c.wallet,
        percentage: c.percentage,
        role: c.role,
      })),
    });

    return NextResponse.json({ success: true, projectId: project.id });
  } catch (error) {
    console.error("[POST /api/project]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
