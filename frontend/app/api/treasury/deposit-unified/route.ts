// frontend/app/api/treasury/deposit-unified/route.ts
// Tops up the treasury via Circle's Unified Balance Kit (Gateway v1): USDC the
// platform already holds on another chain (e.g. Base Sepolia) is deposited
// into Gateway, then spent (minted) directly onto Arc and credited to the
// caller's treasury - no manual bridging step. Additive to Stripe and the
// direct-on-chain-transfer onramps.
//
// POST { action: "deposit", source, amount } - deposits into Gateway on `source`.
// POST { action: "spend", source, amount }    - mints on Arc, credits treasury.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, authErrorResponse } from "@/lib/auth";
import {
  depositToGateway,
  spendToArc,
  SUPPORTED_UNIFIED_BALANCE_SOURCES,
  type UnifiedBalanceSource,
} from "@/lib/unifiedBalanceKit";

function parseSource(value: unknown): UnifiedBalanceSource {
  if (typeof value === "string" && value in SUPPORTED_UNIFIED_BALANCE_SOURCES) {
    return value as UnifiedBalanceSource;
  }
  throw Object.assign(new Error(`Unsupported source chain: ${value}`), { status: 400 });
}

export async function POST(request: Request) {
  let userPrivyId: string;
  try {
    userPrivyId = await requireUser(request);
  } catch (e) {
    const { error, status } = authErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }

  try {
    const body = await request.json();
    const source = parseSource(body.source);
    const amount = body.amount;
    if (typeof amount !== "string" || !amount || Number(amount) <= 0) {
      return NextResponse.json({ error: "A valid decimal amount is required" }, { status: 400 });
    }

    if (body.action === "deposit") {
      // Gateway's provider + gas fee for the later spend is deducted from the
      // source balance on top of the spent amount, so deposit a small buffer
      // beyond what will actually be minted on Arc.
      const depositAmount = (Number(amount) + 0.02).toFixed(6);
      const result = await depositToGateway(source, depositAmount);
      return NextResponse.json(result);
    }

    if (body.action === "spend") {
      const result = await spendToArc(source, amount);

      const user = await prisma.user.upsert({
        where: { privyId: userPrivyId },
        update: {},
        create: { privyId: userPrivyId },
      });

      const amountRaw = BigInt(Math.round(Number(amount) * 1_000_000));
      await prisma.treasuryDeposit.create({
        data: {
          userId: user.id,
          source: "CRYPTO",
          amount: amountRaw,
          status: "CONFIRMED",
          txHash: result.txHash,
          confirmedAt: new Date(),
        },
      });

      return NextResponse.json({ amount: amountRaw.toString(), txHash: result.txHash, explorerUrl: result.explorerUrl });
    }

    return NextResponse.json({ error: "action must be 'deposit' or 'spend'" }, { status: 400 });
  } catch (error: any) {
    console.error("[POST /api/treasury/deposit-unified]", error);
    return NextResponse.json({ error: error?.message ?? "Internal server error" }, { status: 500 });
  }
}
