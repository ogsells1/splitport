// frontend/app/api/treasury/route.ts
// GET /api/treasury?userPrivyId=...  — custodial treasury balance + recent deposits

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userPrivyId = searchParams.get("userPrivyId");

    if (!userPrivyId) {
      return NextResponse.json({ error: "userPrivyId is required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { privyId: userPrivyId } });
    if (!user) {
      // No user row yet — nothing deposited.
      return NextResponse.json({ balance: "0", deposits: [] });
    }

    const [deposits, allocations] = await Promise.all([
      prisma.treasuryDeposit.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.allocation.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    const confirmed = deposits
      .filter((d) => d.status === "CONFIRMED")
      .reduce((sum, d) => sum + d.amount, 0n);
    const allocated = allocations.reduce((sum, a) => sum + a.amount, 0n);
    const balance = confirmed - allocated;

    return NextResponse.json({
      balance: balance.toString(),
      deposits: deposits.map((d) => ({
        id: d.id,
        source: d.source,
        amount: d.amount.toString(),
        status: d.status,
        txHash: d.txHash,
        createdAt: d.createdAt,
        confirmedAt: d.confirmedAt,
      })),
      allocations: allocations.map((a) => ({
        id: a.id,
        contractAddress: a.contractAddress,
        amount: a.amount.toString(),
        txHash: a.txHash,
        createdAt: a.createdAt,
      })),
    });
  } catch (error) {
    console.error("[GET /api/treasury]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
