// frontend/app/api/cabinet/route.ts
// GET /api/cabinet?wallet=0x... — a contributor's claimable balance and history.
// Keyed by payout wallet; the caller passes their authenticated Privy wallet.

import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get("wallet");

    if (!wallet || !isAddress(wallet)) {
      return NextResponse.json({ error: "A valid wallet is required" }, { status: 400 });
    }

    const payouts = await prisma.payout.findMany({
      where: { wallet: wallet.toLowerCase() },
      orderBy: { createdAt: "desc" },
      include: { project: { select: { name: true, contractAddress: true } } },
    });

    const claimable = payouts
      .filter((p) => p.status === "PENDING")
      .reduce((s, p) => s + p.amount, 0n);

    return NextResponse.json({
      claimable: claimable.toString(),
      payouts: payouts.map((p) => ({
        id: p.id,
        projectName: p.project.name,
        amount: p.amount.toString(),
        status: p.status,
        netAmount: p.netAmount?.toString() ?? null,
        feeAmount: p.feeAmount?.toString() ?? null,
        txHash: p.txHash,
        createdAt: p.createdAt,
        claimedAt: p.claimedAt,
      })),
    });
  } catch (error) {
    console.error("[GET /api/cabinet]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
