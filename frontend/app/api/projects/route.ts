// frontend/app/api/projects/route.ts
// GET /api/projects?ownerPrivyId=... — список проектов пользователя

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ownerPrivyId = searchParams.get("ownerPrivyId");

    if (!ownerPrivyId) {
      return NextResponse.json({ error: "ownerPrivyId is required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { privyId: ownerPrivyId } });
    if (!user) {
      return NextResponse.json({ projects: [] });
    }

    const projects = await prisma.project.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        contributors: { where: { active: true } },
      },
    });

    return NextResponse.json({
      projects: projects.map((p: typeof projects[number]) => ({
        id: p.id,
        name: p.name,
        contractAddress: p.contractAddress,
        chainId: p.chainId,
        createdAt: p.createdAt,
        contributorCount: p.contributors.length,
      })),
    });
  } catch (error) {
    console.error("[GET /api/projects]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
