// frontend/app/api/cabinet/route.ts
// GET /api/cabinet?wallet=0x... — a contributor's claimable balance and history.
// Keyed by wallet; the caller passes their authenticated Privy wallet. Claimable
// is the sum of pending lump-sum payouts plus accrued-but-unclaimed stream funds.

import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { prisma } from "@/lib/prisma";
import { claimableNow, accruedAmount } from "@/lib/stream";
import { requireWallet, authErrorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get("wallet");

    if (!wallet || !isAddress(wallet)) {
      return NextResponse.json({ error: "A valid wallet is required" }, { status: 400 });
    }

    try {
      await requireWallet(request, wallet);
    } catch (e) {
      const { error, status } = authErrorResponse(e);
      return NextResponse.json({ error }, { status });
    }

    const walletLc = wallet.toLowerCase();

    const [payouts, shares] = await Promise.all([
      prisma.payout.findMany({
        where: { wallet: walletLc },
        orderBy: { createdAt: "desc" },
        include: { project: { select: { name: true, contractAddress: true } } },
      }),
      prisma.streamShare.findMany({
        where: { wallet: walletLc },
        include: { stream: { include: { project: { select: { name: true } } } } },
      }),
    ]);

    const payoutClaimable = payouts
      .filter((p) => p.status === "PENDING")
      .reduce((s, p) => s + p.amount, 0n);

    const now = new Date();
    const streamClaimable = shares.reduce(
      (s, sh) => s + claimableNow(sh, sh.stream, now),
      0n
    );

    return NextResponse.json({
      claimable: (payoutClaimable + streamClaimable).toString(),
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
      streams: shares.map((sh) => ({
        id: sh.id,
        projectName: sh.stream.project.name,
        total: sh.amount.toString(),
        accrued: accruedAmount(sh.amount, sh.stream.startAt, sh.stream.endAt, now).toString(),
        claimed: sh.claimedAmount.toString(),
        claimable: claimableNow(sh, sh.stream, now).toString(),
        startAt: sh.stream.startAt,
        endAt: sh.stream.endAt,
        status: sh.stream.status,
      })),
    });
  } catch (error) {
    console.error("[GET /api/cabinet]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
