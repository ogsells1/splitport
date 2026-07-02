// frontend/app/api/treasury/deposit-crypto/route.ts
// POST /api/treasury/deposit-crypto — credit a deposit after USDC is sent on-chain.
//
// Custodial mode: user sends to the platform treasury wallet; we verify and credit DB.
// Vault mode:     user sends to the project's SplitVault; we verify and credit DB.
//   Pass `contractAddress` (vault) in the request body; `userPrivyId` still required
//   for attribution. On-chain balance is the source of truth; DB entry is the audit trail.

import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem, getAddress, isAddress, type Hash } from "viem";
import { prisma } from "@/lib/prisma";
import { USDC_ADDRESS } from "@/lib/contract";
import { arcTestnet } from "@/lib/executor";

const client = createPublicClient({ chain: arcTestnet, transport: http() });

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userPrivyId, txHash, contractAddress } = body;

    if (!userPrivyId || !txHash || typeof txHash !== "string") {
      return NextResponse.json({ error: "userPrivyId and txHash are required" }, { status: 400 });
    }

    // Determine destination address to verify the transfer against.
    let destination: string;
    if (process.env.CUSTODY_MODE === "onchain") {
      if (!contractAddress || !isAddress(contractAddress)) {
        return NextResponse.json(
          { error: "contractAddress (vault) is required in onchain mode" },
          { status: 400 }
        );
      }
      destination = contractAddress;
    } else {
      const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_ADDRESS;
      if (!treasuryAddress) {
        return NextResponse.json(
          { error: "Crypto top-up is not configured (missing NEXT_PUBLIC_TREASURY_ADDRESS)." },
          { status: 503 }
        );
      }
      destination = treasuryAddress;
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

    const dest = getAddress(destination);
    const usdc = getAddress(USDC_ADDRESS);

    // Sum all USDC Transfer events to the destination in this tx's block.
    let total = 0n;
    const logs = await client.getLogs({
      address: usdc,
      event: TRANSFER_EVENT,
      args: { to: dest },
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
        { error: "No USDC transfer to the destination address found in this transaction." },
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
