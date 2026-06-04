import { useEffect, useState } from "react";
import { createPublicClient, http, parseAbiItem, formatUnits } from "viem";

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
} as const;

const VAULT_ADDRESS = "0x2DB3dbDA6C5F5CfF3234CDBadD049D90412c1774" as const;
const DEPLOY_BLOCK = 42802682n; // block when contract was deployed
const CHUNK_SIZE = 9000n;

export type TxType = "deposit" | "payment" | "distribution";

export interface VaultEvent {
  type: TxType;
  txHash: string;
  blockNumber: bigint;
  timestamp?: number;
  from?: string;
  wallet?: string;
  role?: string;
  contributorCount?: number;
  amount: bigint;
  amountFormatted: string;
}

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
  event: any,
  fromBlock: bigint,
  toBlock: bigint
): Promise<any[]> {
  const results: any[] = [];
  let start = fromBlock;

  while (start <= toBlock) {
    const end = start + CHUNK_SIZE > toBlock ? toBlock : start + CHUNK_SIZE;
    try {
      const logs = await client.getLogs({
        address: VAULT_ADDRESS,
        event,
        fromBlock: start,
        toBlock: end,
      });
      results.push(...logs);
    } catch {
      // skip failed chunk
    }
    start = end + 1n;
  }

  return results;
}

export function useVaultEvents() {
  const [events, setEvents] = useState<VaultEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchEvents() {
      try {
        setLoading(true);
        setError(null);

        const currentBlock = await client.getBlockNumber();

        const [depositLogs, paymentLogs, distributionLogs] = await Promise.all([
          getLogsChunked(DEPOSIT_ABI, DEPLOY_BLOCK, currentBlock),
          getLogsChunked(PAYMENT_ABI, DEPLOY_BLOCK, currentBlock),
          getLogsChunked(DISTRIBUTION_ABI, DEPLOY_BLOCK, currentBlock),
        ]);

        const allEvents: VaultEvent[] = [];

        for (const log of depositLogs) {
          allEvents.push({
            type: "deposit",
            txHash: log.transactionHash ?? "",
            blockNumber: log.blockNumber ?? 0n,
            from: log.args.from,
            amount: log.args.amount ?? 0n,
            amountFormatted: formatUnits(log.args.amount ?? 0n, 6),
          });
        }

        for (const log of paymentLogs) {
          allEvents.push({
            type: "payment",
            txHash: log.transactionHash ?? "",
            blockNumber: log.blockNumber ?? 0n,
            wallet: log.args.wallet,
            role: log.args.role,
            amount: log.args.amount ?? 0n,
            amountFormatted: formatUnits(log.args.amount ?? 0n, 6),
          });
        }

        for (const log of distributionLogs) {
          allEvents.push({
            type: "distribution",
            txHash: log.transactionHash ?? "",
            blockNumber: log.blockNumber ?? 0n,
            contributorCount: Number(log.args.contributorCount ?? 0n),
            amount: log.args.totalAmount ?? 0n,
            amountFormatted: formatUnits(log.args.totalAmount ?? 0n, 6),
          });
        }

        const uniqueBlocks = [...new Set(allEvents.map((e) => e.blockNumber))];
        const blockTimestamps = new Map<bigint, number>();

        await Promise.all(
          uniqueBlocks.map(async (blockNum) => {
            try {
              const block = await client.getBlock({ blockNumber: blockNum });
              blockTimestamps.set(blockNum, Number(block.timestamp));
            } catch {
              // ignore
            }
          })
        );

        const enriched = allEvents
          .map((e) => ({
            ...e,
            timestamp: blockTimestamps.get(e.blockNumber),
          }))
          .sort((a, b) => Number(b.blockNumber - a.blockNumber));

        setEvents(enriched);
      } catch (err: any) {
        setError(err?.message ?? "Failed to fetch events");
      } finally {
        setLoading(false);
      }
    }

    fetchEvents();
  }, []);

  return { events, loading, error };
}
