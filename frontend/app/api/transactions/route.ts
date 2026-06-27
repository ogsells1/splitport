// frontend/app/api/transactions/route.ts
// GET  /api/transactions        — список транзакций проекта
// POST /api/transactions/sync   — синхронизировать события из chain в БД

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const CONTRACT_ADDRESS = "0x2DB3dbDA6C5F5CfF3234CDBadD049D90412c1774";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // "DEPOSIT" | "PAYMENT" | "DISTRIBUTION" | null
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
    const offset = parseInt(searchParams.get("offset") ?? "0");

    const project = await prisma.project.findUnique({
      where: { contractAddress: CONTRACT_ADDRESS },
    });

    if (!project) {
      return NextResponse.json({ transactions: [], total: 0 });
    }

    const where = {
      projectId: project.id,
      ...(type ? { type: type as any } : {}),
    };

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { blockNumber: "desc" },
        take: limit,
        skip: offset,
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
