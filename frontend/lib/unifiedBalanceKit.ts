// frontend/lib/unifiedBalanceKit.ts
// Circle Unified Balance Kit (Gateway v1) - lets the treasury be funded from a
// USDC balance the executor already holds on another chain (e.g. Base Sepolia),
// depositing into Gateway and instantly minting onto Arc Testnet. Additive to
// the existing Stripe and direct-on-chain-transfer onramps.

import { createPublicClient, fallback, http } from "viem";
import {
  createUnifiedBalanceKitContext,
  deposit,
  spend,
  getBalances,
} from "@circle-fin/unified-balance-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";

// Source chains a treasury can be topped up from, beyond a direct Arc transfer.
export const SUPPORTED_UNIFIED_BALANCE_SOURCES = {
  "base-sepolia": "Base_Sepolia",
} as const;

export type UnifiedBalanceSource = keyof typeof SUPPORTED_UNIFIED_BALANCE_SOURCES;

const context = createUnifiedBalanceKitContext();

// Arc Testnet's default public RPC rate-limits under load; drpc.org is tried
// first, with the default endpoint as a fallback. Other chains use the SDK's
// built-in defaults.
const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_RPC_URLS = ["https://arc-testnet.drpc.org", "https://rpc.testnet.arc.network/"];

function getAdapter() {
  const key = process.env.EXECUTOR_PRIVATE_KEY;
  if (!key) throw new Error("Unified Balance is not configured (missing EXECUTOR_PRIVATE_KEY)");
  return createViemAdapterFromPrivateKey({
    privateKey: (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`,
    getPublicClient: ({ chain }) =>
      createPublicClient({
        chain,
        transport:
          chain.id === ARC_TESTNET_CHAIN_ID
            ? fallback(ARC_RPC_URLS.map((url) => http(url)))
            : http(),
      }),
  });
}

/** Deposits `amount` (decimal USDC string) the executor holds on `source` into Circle Gateway. */
export async function depositToGateway(source: UnifiedBalanceSource, amount: string) {
  const adapter = getAdapter();
  return deposit(context, {
    from: { adapter, chain: SUPPORTED_UNIFIED_BALANCE_SOURCES[source] },
    amount,
  });
}

/** Mints `amount` on Arc Testnet by spending a confirmed Gateway balance on `source`. */
export async function spendToArc(source: UnifiedBalanceSource, amount: string) {
  const adapter = getAdapter();
  const result = await spend(context, {
    amount,
    from: { adapter, allocations: { amount, chain: SUPPORTED_UNIFIED_BALANCE_SOURCES[source] } },
    to: { adapter, chain: "Arc_Testnet" },
  });
  return result;
}

/** Confirmed Gateway balance the executor has on `source`, ready to spend. */
export async function getGatewayBalance(source: UnifiedBalanceSource): Promise<string> {
  const adapter = getAdapter();
  const balances = await getBalances(context, {
    sources: { adapter, chains: [SUPPORTED_UNIFIED_BALANCE_SOURCES[source]] },
  });
  return balances.totalConfirmedBalance;
}
