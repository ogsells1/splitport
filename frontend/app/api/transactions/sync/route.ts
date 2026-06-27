// frontend/app/api/transactions/sync/route.ts
// POST /api/transactions/sync — читает события из chain и сохраняет в БД
// Вызывать вручную или по cron (Vercel Cron Jobs)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createPublicClient, http, parseAbiItem, formatUnits } from "viem";

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
} as const;

const VAULT_ADDRESS = "0x2DB3dbDA6C5F5CfF3234CDBadD049D90412c1774" as const;
const DEPLOY_BLOCK = 42802682n;
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

async function getLogsChunked(event: any, fromBlock: bigint, toBlock: bigint) {
  const results: any[] = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + CHUNK_SIZE > toBlock ? toBlock : start + CHUNK_SIZE;
    try {
      const logs = await client.getLogs({ address: VAULT_ADDRESS, event, fromBlock: start, toBlock: end });
      results.push(...logs);
    } catch {
      // skip failed chunk
    }
    start = end + 1n;
  }
  return results;
}

export async function POST() {
  try {
    // 1. Найти проект в БД
    const project = await prisma.project.findUnique({
      where: { contractAddress: VAULT_ADDRESS },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found in DB. Run POST /api/project first." }, { status: 404 });
    }

    // 2. Найти последний синхронизированный блок
    const lastTx = await prisma.transaction.findFirst({
      where: { projectId: project.id },
      orderBy: { blockNumber: "desc" },
    });
    const fromBlock = lastTx ? lastTx.blockNumber + 1n : DEPLOY_BLOCK;
    const toBlock = await client.getBlockNumber();

    if (fromBlock > toBlock) {
      return NextResponse.json({ synced: 0, message: "Already up to date" });
    }

    // 3. Fetch logs
    const [depositLogs, paymentLogs, distributionLogs] = await Promise.all([
      getLogsChunked(DEPOSIT_ABI, fromBlock, toBlock),
      getLogsChunked(PAYMENT_ABI, fromBlock, toBlock),
      getLogsChunked(DISTRIBUTION_ABI, fromBlock, toBlock),
    ]);

    // 4. Получить timestamp для уникальных блоков
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

    // 5. Upsert транзакции
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
      // PaymentSent может быть несколько в одной tx — делаем составной ключ
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

    return NextResponse.json({
      synced,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
    });
  } catch (error: any) {
    console.error("[POST /api/transactions/sync]", error);
    return NextResponse.json({ error: error?.message ?? "Internal server error" }, { status: 500 });
  }
}
