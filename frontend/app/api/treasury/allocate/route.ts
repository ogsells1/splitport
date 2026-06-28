// frontend/app/api/treasury/allocate/route.ts
// POST /api/treasury/allocate — move part of the user's custodial treasury balance
// into a project vault. The executor wallet does approve + depositRevenue on-chain;
// we record an Allocation that debits the treasury balance.

import { NextResponse } from "next/server";
import { getAddress, parseUnits, formatUnits, type Address } from "viem";
import { prisma } from "@/lib/prisma";
import { getExecutor } from "@/lib/executor";
import { USDC_ADDRESS, USDC_ABI, VAULT_ABI } from "@/lib/contract";

export async function POST(request: Request) {
  try {
    const executor = getExecutor();
    if (!executor) {
      return NextResponse.json(
        { error: "Allocation is not configured (missing EXECUTOR_PRIVATE_KEY)." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { userPrivyId, contractAddress, amount } = body;

    const amountNum = Number(amount);
    if (!userPrivyId || !contractAddress || !Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { error: "userPrivyId, contractAddress and a positive amount are required" },
        { status: 400 }
      );
    }

    const amountUsdc = parseUnits(String(amountNum), 6);

    const user = await prisma.user.findUnique({ where: { privyId: userPrivyId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const project = await prisma.project.findUnique({ where: { contractAddress } });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Compute available treasury balance: confirmed deposits − prior allocations.
    const [deposits, allocations] = await Promise.all([
      prisma.treasuryDeposit.findMany({ where: { userId: user.id, status: "CONFIRMED" } }),
      prisma.allocation.findMany({ where: { userId: user.id } }),
    ]);
    const deposited = deposits.reduce((s, d) => s + d.amount, 0n);
    const allocated = allocations.reduce((s, a) => s + a.amount, 0n);
    const available = deposited - allocated;

    if (amountUsdc > available) {
      return NextResponse.json(
        {
          error: `Insufficient treasury balance. Available: ${formatUnits(available, 6)} USDC.`,
        },
        { status: 400 }
      );
    }

    const { walletClient, publicClient, account } = executor;
    const vault = getAddress(contractAddress) as Address;
    const usdc = getAddress(USDC_ADDRESS) as Address;

    // Make sure the executor wallet actually holds enough USDC on-chain.
    const onChainBalance = (await publicClient.readContract({
      address: usdc,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;

    if (onChainBalance < amountUsdc) {
      return NextResponse.json(
        {
          error:
            "Treasury wallet is underfunded on-chain. Fund it with USDC from the faucet and retry.",
        },
        { status: 409 }
      );
    }

    // 1) approve the vault to pull USDC
    const approveTx = await walletClient.writeContract({
      address: usdc,
      abi: USDC_ABI,
      functionName: "approve",
      args: [vault, amountUsdc],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });

    // 2) deposit into the vault
    const depositTx = await walletClient.writeContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: "depositRevenue",
      args: [amountUsdc],
    });
    await publicClient.waitForTransactionReceipt({ hash: depositTx });

    await prisma.allocation.create({
      data: {
        userId: user.id,
        contractAddress: vault,
        amount: amountUsdc,
        txHash: depositTx,
      },
    });

    // Best-effort: surface the new DEPOSIT in project history.
    const origin = new URL(request.url).origin;
    fetch(`${origin}/api/transactions/sync?contractAddress=${vault}`, { method: "POST" }).catch(
      () => {}
    );

    return NextResponse.json({ txHash: depositTx, amount: amountUsdc.toString() });
  } catch (error: any) {
    console.error("[POST /api/treasury/allocate]", error);
    return NextResponse.json({ error: error?.shortMessage ?? error?.message ?? "Internal server error" }, { status: 500 });
  }
}
