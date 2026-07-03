// frontend/app/api/projects/route.ts
// GET /api/projects?ownerPrivyId=... – список проектов пользователя

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, authErrorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  let ownerPrivyId: string;
  try {
    ownerPrivyId = await requireUser(request);
  } catch (e) {
    const { error, status } = authErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }

  try {
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
