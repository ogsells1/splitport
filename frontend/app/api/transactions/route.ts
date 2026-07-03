// frontend/app/api/transactions/route.ts
// GET /api/transactions - список транзакций
//   ?contractAddress=0x...   - только для этого проекта
//   ?ownerPrivyId=...        - по всем проектам пользователя (унифицированная история)
// Один из двух параметров обязателен.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, authErrorResponse } from "@/lib/auth";

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
    const type = searchParams.get("type"); // "DEPOSIT" | "PAYMENT" | "DISTRIBUTION" | null
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
    const offset = parseInt(searchParams.get("offset") ?? "0");

    // The caller can only see their own projects' transactions. A single-project
    // filter (contractAddress) is scoped to projects they own.
    const user = await prisma.user.findUnique({ where: { privyId: requesterPrivyId } });
    if (!user) return NextResponse.json({ transactions: [], total: 0 });

    let projectIds: string[];

    if (contractAddress) {
      const project = await prisma.project.findUnique({ where: { contractAddress } });
      if (!project || project.ownerId !== user.id) {
        return NextResponse.json({ transactions: [], total: 0 });
      }
      projectIds = [project.id];
    } else {
      const projects = await prisma.project.findMany({
        where: { ownerId: user.id },
        select: { id: true },
      });
      projectIds = projects.map((p: { id: string }) => p.id);
      if (projectIds.length === 0) return NextResponse.json({ transactions: [], total: 0 });
    }

    const where = {
      projectId: { in: projectIds },
      ...(type ? { type: type as any } : {}),
    };

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { blockNumber: "desc" },
        take: limit,
        skip: offset,
        include: { project: { select: { name: true, contractAddress: true } } },
      }),
      prisma.transaction.count({ where }),
    ]);

    return NextResponse.json({
      transactions: transactions.map((tx: typeof transactions[number]) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount.toString(),
        txHash: tx.txHash,
        blockNumber: tx.blockNumber.toString(),
        timestamp: tx.timestamp,
        fromAddress: tx.fromAddress,
        toAddress: tx.toAddress,
        role: tx.role,
        project: {
          name: tx.project.name,
          contractAddress: tx.project.contractAddress,
        },
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[GET /api/transactions]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
