// frontend/app/api/transactions/sync/route.ts
// POST /api/transactions/sync?contractAddress=0x...  – синк одного проекта (ручной вызов из UI)
// GET  /api/transactions/sync[?contractAddress=0x...] – вызывается Vercel Cron Job (см. vercel.json).
//      Без contractAddress синкает ВСЕ проекты в БД.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createPublicClient, http, parseAbiItem } from "viem";
import { requireUser, authErrorResponse, isCronAuthorized } from "@/lib/auth";

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
} as const;

const FALLBACK_DEPLOY_BLOCK = 42802682n; // легаси demo-проект, если deployBlock не задан
const CHUNK_SIZE = 9000n;

const client = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

const DEPOSIT_ABI = parseAbiItem(
  "event RevenueDeposited(address indexed from, uint256 amount, uint256 timestamp)"
);
const PAYMENT_ABI = parseAbiItem(
  "event PaymentSent(address indexed wallet, uint256 amount, string role)"
);
const DISTRIBUTION_ABI = parseAbiItem(
  "event RevenueDistributed(uint256 totalAmount, uint256 contributorCount, uint256 timestamp)"
);

async function getLogsChunked(
  address: `0x${string}`,
  event: any,
  fromBlock: bigint,
  toBlock: bigint
) {
  const results: any[] = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + CHUNK_SIZE > toBlock ? toBlock : start + CHUNK_SIZE;
    try {
      const logs = await client.getLogs({ address, event, fromBlock: start, toBlock: end });
      results.push(...logs);
    } catch {
      // skip failed chunk
    }
    start = end + 1n;
  }
  return results;
}

async function syncProject(project: {
  id: string;
  contractAddress: string;
  deployBlock: bigint | null;
}) {
  const vaultAddress = project.contractAddress as `0x${string}`;

  const lastTx = await prisma.transaction.findFirst({
    where: { projectId: project.id },
    orderBy: { blockNumber: "desc" },
  });
  const fromBlock = lastTx ? lastTx.blockNumber + 1n : project.deployBlock ?? FALLBACK_DEPLOY_BLOCK;
  const toBlock = await client.getBlockNumber();

  if (fromBlock > toBlock) {
    return { contractAddress: project.contractAddress, synced: 0, message: "Already up to date" };
  }

  const [depositLogs, paymentLogs, distributionLogs] = await Promise.all([
    getLogsChunked(vaultAddress, DEPOSIT_ABI, fromBlock, toBlock),
    getLogsChunked(vaultAddress, PAYMENT_ABI, fromBlock, toBlock),
    getLogsChunked(vaultAddress, DISTRIBUTION_ABI, fromBlock, toBlock),
  ]);

  const allLogs = [...depositLogs, ...paymentLogs, ...distributionLogs];
  const uniqueBlocks = [...new Set(allLogs.map((l) => l.blockNumber as bigint))];
  const blockTimestamps = new Map<bigint, Date>();
  await Promise.all(
    uniqueBlocks.map(async (blockNum) => {
      try {
        const block = await client.getBlock({ blockNumber: blockNum });
        blockTimestamps.set(blockNum, new Date(Number(block.timestamp) * 1000));
      } catch {}
    })
  );

  let synced = 0;

  for (const log of depositLogs) {
    if (!log.transactionHash) continue;
    await prisma.transaction.upsert({
      where: { txHash: log.transactionHash },
      update: {},
      create: {
        projectId: project.id,
        type: "DEPOSIT",
        amount: log.args.amount ?? 0n,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber ?? 0n,
        timestamp: blockTimestamps.get(log.blockNumber) ?? new Date(),
        fromAddress: log.args.from,
      },
    });
    synced++;
  }

  for (const log of paymentLogs) {
    if (!log.transactionHash) continue;
    const syntheticHash = `${log.transactionHash}-${log.logIndex}`;
    await prisma.transaction.upsert({
      where: { txHash: syntheticHash },
      update: {},
      create: {
        projectId: project.id,
        type: "PAYMENT",
        amount: log.args.amount ?? 0n,
        txHash: syntheticHash,
        blockNumber: log.blockNumber ?? 0n,
        timestamp: blockTimestamps.get(log.blockNumber) ?? new Date(),
        toAddress: log.args.wallet,
        role: log.args.role,
      },
    });
    synced++;
  }

  for (const log of distributionLogs) {
    if (!log.transactionHash) continue;
    await prisma.transaction.upsert({
      where: { txHash: log.transactionHash },
      update: {},
      create: {
        projectId: project.id,
        type: "DISTRIBUTION",
        amount: log.args.totalAmount ?? 0n,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber ?? 0n,
        timestamp: blockTimestamps.get(log.blockNumber) ?? new Date(),
      },
    });
    synced++;
  }

  return {
    contractAddress: project.contractAddress,
    synced,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
  };
}

export async function POST(request: NextRequest) {
  try {
    await requireUser(request);
  } catch (e) {
    const { error, status } = authErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }

  try {
    const contractAddress = request.nextUrl.searchParams.get("contractAddress");
    if (!contractAddress) {
      return NextResponse.json({ error: "contractAddress is required" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({ where: { contractAddress } });
    if (!project) {
      return NextResponse.json(
        { error: "Project not found in DB. Run POST /api/project first." },
        { status: 404 }
      );
    }

    const result = await syncProject(project);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[POST /api/transactions/sync]", error);
    return NextResponse.json({ error: error?.message ?? "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const contractAddress = request.nextUrl.searchParams.get("contractAddress");

    if (contractAddress) {
      const project = await prisma.project.findUnique({ where: { contractAddress } });
      if (!project) {
        return NextResponse.json({ error: "Project not found in DB" }, { status: 404 });
      }
      const result = await syncProject(project);
      return NextResponse.json(result);
    }

    // No contractAddress – cron mode: sync every project in the DB.
    const projects = await prisma.project.findMany();
    const results = [];
    for (const project of projects) {
      results.push(await syncProject(project));
    }
    return NextResponse.json({ projects: results.length, results });
  } catch (error: any) {
    console.error("[GET /api/transactions/sync]", error);
    return NextResponse.json({ error: error?.message ?? "Internal server error" }, { status: 500 });
  }
}
