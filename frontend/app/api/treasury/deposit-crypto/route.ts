// frontend/app/api/treasury/deposit-crypto/route.ts
// POST /api/treasury/deposit-crypto — credit a treasury top-up after the user
// sends USDC to the platform treasury wallet. The frontend submits the txHash;
// we verify on-chain that a USDC Transfer to the treasury address actually
// happened, then record a CONFIRMED deposit (idempotent on txHash).

import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem, getAddress, type Hash } from "viem";
import { prisma } from "@/lib/prisma";
import { USDC_ADDRESS } from "@/lib/contract";

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
} as const;

const client = createPublicClient({ chain: arcTestnet, transport: http() });

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

export async function POST(request: Request) {
  try {
    const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_ADDRESS;
    if (!treasuryAddress) {
      return NextResponse.json(
        { error: "Crypto top-up is not configured (missing NEXT_PUBLIC_TREASURY_ADDRESS)." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { userPrivyId, txHash } = body;

    if (!userPrivyId || !txHash || typeof txHash !== "string") {
      return NextResponse.json({ error: "userPrivyId and txHash are required" }, { status: 400 });
    }

    // Idempotency: if we already recorded this tx, just return it.
    const existing = await prisma.treasuryDeposit.findUnique({ where: { txHash } });
    if (existing) {
      return NextResponse.json({ amount: existing.amount.toString(), alreadyRecorded: true });
    }

    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: txHash as Hash });
    } catch {
      return NextResponse.json(
        { error: "Transaction not found yet — wait for it to be mined and try again." },
        { status: 400 }
      );
    }
    if (!receipt || receipt.status !== "success") {
      return NextResponse.json({ error: "Transaction not found or failed" }, { status: 400 });
    }

    const treasury = getAddress(treasuryAddress);
    const usdc = getAddress(USDC_ADDRESS);

    // Sum all USDC Transfer events to the treasury wallet, scoped to this tx's block.
    let total = 0n;
    const logs = await client.getLogs({
      address: usdc,
      event: TRANSFER_EVENT,
      args: { to: treasury },
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });

    for (const log of logs) {
      if (log.transactionHash?.toLowerCase() === txHash.toLowerCase()) {
        total += log.args.value ?? 0n;
      }
    }

    if (total <= 0n) {
      return NextResponse.json(
        { error: "No USDC transfer to the treasury wallet found in this transaction." },
        { status: 400 }
      );
    }

    const user = await prisma.user.upsert({
      where: { privyId: userPrivyId },
      update: {},
      create: { privyId: userPrivyId },
    });

    await prisma.treasuryDeposit.create({
      data: {
        userId: user.id,
        source: "CRYPTO",
        amount: total,
        status: "CONFIRMED",
        txHash,
        confirmedAt: new Date(),
      },
    });

    return NextResponse.json({ amount: total.toString() });
  } catch (error: any) {
    console.error("[POST /api/treasury/deposit-crypto]", error);
    return NextResponse.json({ error: error?.message ?? "Internal server error" }, { status: 500 });
  }
}
