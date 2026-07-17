// frontend/lib/executor.ts
// Server-side treasury/executor wallet. Holds USDC and pushes funds into project
// vaults on behalf of users when they allocate their custodial treasury balance.
// Requires EXECUTOR_PRIVATE_KEY; gas token on Arc is USDC, so the wallet must
// also hold a little USDC for fees.

import { createPublicClient, createWalletClient, fallback, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// The default public RPC (rpc.testnet.arc.network) rate-limits under load;
// drpc.org is used first with the default endpoint as a fallback.
const ARC_RPC_URLS = ["https://arc-testnet.drpc.org", "https://rpc.testnet.arc.network"];

export const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: ARC_RPC_URLS } },
} as const;

function arcTransport() {
  return fallback(ARC_RPC_URLS.map((url) => http(url)));
}

export function getExecutor() {
  const key = process.env.EXECUTOR_PRIVATE_KEY;
  if (!key) return null;

  const account = privateKeyToAccount(key.startsWith("0x") ? (key as `0x${string}`) : `0x${key}`);
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: arcTransport() });
  const publicClient = createPublicClient({ chain: arcTestnet, transport: arcTransport() });

  return { account, walletClient, publicClient };
}
