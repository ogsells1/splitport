// frontend/app/api/project/create/route.ts
// POST /api/project/create — create a DB-first project (no on-chain contract).
// Contributors can be added by wallet (CLAIMED) or by invite (PENDING + token).
// Neither owner nor contributors need a wallet or gas to create a project; payouts
// run custodially through the treasury. The synthetic `db_…` id is used as the
// project's contractAddress so all existing routing keeps working.

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { isAddress } from "viem";
import { prisma } from "@/lib/prisma";

const DEFAULT_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const DEFAULT_CHAIN_ID = 5042002;

interface RowInput {
  role: string;
  percentage: number; // basis points
  wallet?: string | null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ownerPrivyId, name, usdcAddress, contributors } = body as {
      ownerPrivyId?: string;
      name?: string;
      usdcAddress?: string;
      contributors?: RowInput[];
    };

    if (!ownerPrivyId || !name?.trim() || !contributors?.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const totalBps = contributors.reduce((s, c) => s + (c.percentage || 0), 0);
    if (totalBps !== 10000) {
      return NextResponse.json(
        { error: "Contributor percentages must sum to 100%." },
        { status: 400 }
      );
    }
    for (const c of contributors) {
      if (!c.role?.trim()) {
        return NextResponse.json({ error: "Every contributor needs a role." }, { status: 400 });
      }
      if (c.wallet && !isAddress(c.wallet)) {
        return NextResponse.json({ error: `Invalid wallet address: ${c.wallet}` }, { status: 400 });
      }
    }
    const walletList = contributors
      .filter((c) => c.wallet)
      .map((c) => c.wallet!.toLowerCase());
    if (new Set(walletList).size !== walletList.length) {
      return NextResponse.json({ error: "Duplicate wallet addresses are not allowed." }, { status: 400 });
    }

    const contractAddress = `db_${randomBytes(16).toString("hex")}`;

    const project = await prisma.project.create({
      data: {
        name: name.trim(),
        contractAddress,
        usdcAddress: usdcAddress ?? DEFAULT_USDC_ADDRESS,
        chainId: DEFAULT_CHAIN_ID,
        owner: {
          connectOrCreate: {
            where: { privyId: ownerPrivyId },
            create: { privyId: ownerPrivyId },
          },
        },
      },
    });

    const invites: { role: string; percentage: number; inviteToken: string; inviteUrl: string }[] = [];

    await prisma.$transaction(
      contributors.map((c) => {
        if (c.wallet) {
          return prisma.contributor.create({
            data: {
              projectId: project.id,
              wallet: c.wallet!.toLowerCase(),
              percentage: c.percentage,
              role: c.role.trim(),
              status: "CLAIMED",
            },
          });
        }
        const inviteToken = randomBytes(24).toString("base64url");
        invites.push({
          role: c.role.trim(),
          percentage: c.percentage,
          inviteToken,
          inviteUrl: `/invite/${inviteToken}`,
        });
        return prisma.contributor.create({
          data: {
            projectId: project.id,
            wallet: null,
            percentage: c.percentage,
            role: c.role.trim(),
            status: "PENDING",
            inviteToken,
          },
        });
      })
    );

    return NextResponse.json({
      projectId: project.id,
      contractAddress, // synthetic db_ id used for routing
      invites,
    });
  } catch (error: any) {
    console.error("[POST /api/project/create]", error);
    return NextResponse.json({ error: error?.message ?? "Internal server error" }, { status: 500 });
  }
}
