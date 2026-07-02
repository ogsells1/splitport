// frontend/app/api/treasury/route.ts
// GET /api/treasury?userPrivyId=...
// Custodial: DB-computed balance + deposit history.
// Vault:     sum of on-chain vault USDC balances across all user's onchain projects.

import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { prisma } from "@/lib/prisma";
import { getAvailableBalance } from "@/lib/treasuryBalance";
import { getSettlement } from "@/lib/settlement";
import { requireUser, authErrorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  let userPrivyId: string;
  try {
    userPrivyId = await requireUser(request);
  } catch (e) {
    const { error, status } = authErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }

  try {
    const user = await prisma.user.findUnique({ where: { privyId: userPrivyId } });
    if (!user) {
      return NextResponse.json({ balance: "0", deposits: [], distributions: [] });
    }

    const [deposits, distributions] = await Promise.all([
      prisma.treasuryDeposit.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.distribution.findMany({
        where: { project: { ownerId: user.id } },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { project: { select: { name: true, contractAddress: true } } },
      }),
    ]);

    let balance: bigint;
    if (process.env.CUSTODY_MODE === "onchain") {
      // Sum on-chain USDC balances of all vault projects owned by this user.
      const settlement = getSettlement();
      const projects = await prisma.project.findMany({
        where: { ownerId: user.id },
        select: { contractAddress: true },
      });
      const onchainProjects = projects.filter((p) => isAddress(p.contractAddress));
      const balances = await Promise.all(
        onchainProjects.map((p) =>
          settlement.availableBalance(user.id, p.contractAddress).catch(() => 0n)
        )
      );
      balance = balances.reduce((sum, b) => sum + b, 0n);
    } else {
      balance = await getAvailableBalance(user.id);
    }

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
      distributions: distributions.map((d) => ({
        id: d.id,
        projectName: d.project.name,
        contractAddress: d.project.contractAddress,
        total: d.total.toString(),
        createdAt: d.createdAt,
      })),
    });
  } catch (error) {
    console.error("[GET /api/treasury]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
