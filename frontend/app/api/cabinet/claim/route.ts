// frontend/app/api/cabinet/claim/route.ts
// POST /api/cabinet/claim — a contributor claims all their pending payouts.
// The executor wallet sends (total − transfer fee) USDC to the contributor's
// wallet in a single transfer and pays the gas; the fee is deducted from the
// contributor's share, so they cover the transfer cost out of their own money.

import { NextResponse } from "next/server";
import { getAddress, isAddress, type Address } from "viem";
import { prisma } from "@/lib/prisma";
import { getExecutor } from "@/lib/executor";
import { USDC_ADDRESS, USDC_ABI } from "@/lib/contract";

export async function POST(request: Request) {
  try {
    const executor = getExecutor();
    if (!executor) {
      return NextResponse.json(
        { error: "Claims are not configured (missing EXECUTOR_PRIVATE_KEY)." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { wallet } = body;
    if (!wallet || !isAddress(wallet)) {
      return NextResponse.json({ error: "A valid wallet is required" }, { status: 400 });
    }

    const walletLc = wallet.toLowerCase();
    const pending = await prisma.payout.findMany({
      where: { wallet: walletLc, status: "PENDING" },
    });
    if (pending.length === 0) {
      return NextResponse.json({ error: "Nothing to claim" }, { status: 400 });
    }

    const gross = pending.reduce((s, p) => s + p.amount, 0n);

    const { walletClient, publicClient, account } = executor;
    const usdc = getAddress(USDC_ADDRESS) as Address;
    const to = getAddress(wallet) as Address;

    // Estimate the transfer fee (gas in USDC on Arc) and deduct it from the payout.
    let fee: bigint;
    try {
      const gas = await publicClient.estimateContractGas({
        address: usdc,
        abi: USDC_ABI,
        functionName: "transfer",
        args: [to, gross],
        account,
      });
      const gasPrice = await publicClient.getGasPrice();
      // Pad 20% so the deducted fee comfortably covers actual gas.
      fee = (gas * gasPrice * 12n) / 10n;
    } catch {
      return NextResponse.json(
        { error: "Could not estimate the transfer fee. Try again shortly." },
        { status: 502 }
      );
    }

    if (gross <= fee) {
      return NextResponse.json(
        { error: "Your balance is too small to cover the transfer fee yet." },
        { status: 400 }
      );
    }
    const net = gross - fee;

    // Executor must actually hold enough USDC on-chain to pay out + gas.
    const onChainBalance = (await publicClient.readContract({
      address: usdc,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;
    if (onChainBalance < net) {
      return NextResponse.json(
        { error: "Payout wallet is temporarily underfunded. Please try again later." },
        { status: 409 }
      );
    }

    const txHash = await walletClient.writeContract({
      address: usdc,
      abi: USDC_ABI,
      functionName: "transfer",
      args: [to, net],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Mark all claimed payouts. The full tx hash goes on the first; the rest get
    // a synthetic suffix to satisfy the unique constraint while staying traceable.
    await prisma.$transaction(
      pending.map((p, i) =>
        prisma.payout.update({
          where: { id: p.id },
          data: {
            status: "CLAIMED",
            txHash: i === 0 ? txHash : `${txHash}-${i}`,
            // Distribute the fee/net proportionally for record-keeping.
            feeAmount: (fee * p.amount) / gross,
            netAmount: p.amount - (fee * p.amount) / gross,
            claimedAt: new Date(),
          },
        })
      )
    );

    return NextResponse.json({
      txHash,
      gross: gross.toString(),
      fee: fee.toString(),
      net: net.toString(),
    });
  } catch (error: any) {
    console.error("[POST /api/cabinet/claim]", error);
    return NextResponse.json(
      { error: error?.shortMessage ?? error?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
