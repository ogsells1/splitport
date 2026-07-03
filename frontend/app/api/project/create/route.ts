// frontend/app/api/project/create/route.ts
// POST /api/project/create - create a DB-first project (no on-chain contract).
// Contributors can be added by wallet (CLAIMED) or by invite (PENDING + token).
// Neither owner nor contributors need a wallet or gas to create a project; payouts
// run custodially through the treasury. The synthetic `db_…` id is used as the
// project's contractAddress so all existing routing keeps working.

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAddress, isAddress, parseEventLogs, parseUnits, type Address } from "viem";
import { prisma } from "@/lib/prisma";
import { getExecutor } from "@/lib/executor";
import { FACTORY_ABI } from "@/lib/contract";
import { requireUser, authErrorResponse } from "@/lib/auth";

const DEFAULT_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const DEFAULT_CHAIN_ID = 5042002;

interface RowInput {
  role: string;
  percentage?: number; // basis points (PERCENTAGE mode)
  amount?: number; // fixed USDC per payout (FIXED mode)
  wallet?: string | null;
}

export async function POST(request: Request) {
  let ownerPrivyId: string;
  try {
    ownerPrivyId = await requireUser(request);
  } catch (e) {
    const { error, status } = authErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }

  try {
    const body = await request.json();
    const { name, usdcAddress, splitMode: rawMode, contributors } = body as {
      name?: string;
      usdcAddress?: string;
      splitMode?: string;
      contributors?: RowInput[];
    };

    if (!name?.trim() || !contributors?.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const splitMode = rawMode === "FIXED" ? "FIXED" : "PERCENTAGE";

    if (splitMode === "PERCENTAGE") {
      const totalBps = contributors.reduce((s, c) => s + (c.percentage || 0), 0);
      if (totalBps !== 10000) {
        return NextResponse.json(
          { error: "Contributor percentages must sum to 100%." },
          { status: 400 }
        );
      }
    } else {
      for (const c of contributors) {
        if (!(typeof c.amount === "number" && c.amount > 0)) {
          return NextResponse.json(
            { error: "Every contributor needs a fixed amount greater than 0." },
            { status: 400 }
          );
        }
      }
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

    // In onchain mode, deploy a SplitVault via the factory so custody lives on-chain.
    // In custodial mode, use a synthetic db_ id - existing routing branches on isAddress().
    let contractAddress: string;
    if (process.env.CUSTODY_MODE === "onchain") {
      const factoryAddress = process.env.VAULT_FACTORY_ADDRESS;
      if (!factoryAddress || !isAddress(factoryAddress)) {
        return NextResponse.json({ error: "VAULT_FACTORY_ADDRESS not configured" }, { status: 503 });
      }
      const executor = getExecutor();
      if (!executor) {
        return NextResponse.json({ error: "EXECUTOR_PRIVATE_KEY not configured" }, { status: 503 });
      }
      // Owner wallet: look up the user's linked wallet; fall back to executor for testnet.
      const owner = await prisma.user.findUnique({ where: { privyId: ownerPrivyId } });
      const ownerWallet = (owner as any)?.wallet ?? executor.account.address;

      const deployTx = await executor.walletClient.writeContract({
        address: getAddress(factoryAddress) as Address,
        abi: FACTORY_ABI,
        functionName: "createVault",
        args: [getAddress(ownerWallet) as Address],
      });
      const receipt = await executor.publicClient.waitForTransactionReceipt({ hash: deployTx });

      // Parse VaultCreated event to extract the new vault address.
      const [vaultEvent] = parseEventLogs({
        abi: FACTORY_ABI,
        logs: receipt.logs,
        eventName: "VaultCreated",
      });
      if (!vaultEvent) {
        return NextResponse.json({ error: "Could not parse VaultCreated event from factory tx" }, { status: 500 });
      }
      contractAddress = getAddress(String((vaultEvent as any).args.vault));
    } else {
      contractAddress = `db_${randomBytes(16).toString("hex")}`;
    }

    const project = await prisma.project.create({
      data: {
        name: name.trim(),
        contractAddress,
        usdcAddress: usdcAddress ?? DEFAULT_USDC_ADDRESS,
        chainId: DEFAULT_CHAIN_ID,
        splitMode,
        owner: {
          connectOrCreate: {
            where: { privyId: ownerPrivyId },
            create: { privyId: ownerPrivyId },
          },
        },
      },
    });

    // Per-contributor share fields by mode. FIXED stores fixedAmount (percentage 0);
    // PERCENTAGE stores basis points.
    const shareFields = (c: RowInput) =>
      splitMode === "FIXED"
        ? { percentage: 0, fixedAmount: parseUnits(String(c.amount), 6) }
        : { percentage: c.percentage ?? 0, fixedAmount: null };

    const invites: {
      role: string;
      percentage: number;
      amount: number | null;
      inviteToken: string;
      inviteUrl: string;
    }[] = [];

    await prisma.$transaction(
      contributors.map((c) => {
        if (c.wallet) {
          return prisma.contributor.create({
            data: {
              projectId: project.id,
              wallet: c.wallet!.toLowerCase(),
              ...shareFields(c),
              role: c.role.trim(),
              status: "CLAIMED",
            },
          });
        }
        const inviteToken = randomBytes(24).toString("base64url");
        invites.push({
          role: c.role.trim(),
          percentage: c.percentage ?? 0,
          amount: splitMode === "FIXED" ? c.amount ?? null : null,
          inviteToken,
          inviteUrl: `/invite/${inviteToken}`,
        });
        return prisma.contributor.create({
          data: {
            projectId: project.id,
            wallet: null,
            ...shareFields(c),
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
      splitMode,
      invites,
    });
  } catch (error: any) {
    console.error("[POST /api/project/create]", error);
    return NextResponse.json({ error: error?.message ?? "Internal server error" }, { status: 500 });
  }
}
