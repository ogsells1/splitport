// frontend/lib/executor.ts
// Server-side treasury/executor wallet. Holds USDC and pushes funds into project
// vaults on behalf of users when they allocate their custodial treasury balance.
// Requires EXECUTOR_PRIVATE_KEY; gas token on Arc is USDC, so the wallet must
// also hold a little USDC for fees.

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
} as const;

export function getExecutor() {
  const key = process.env.EXECUTOR_PRIVATE_KEY;
  if (!key) return null;

  const account = privateKeyToAccount(key.startsWith("0x") ? (key as `0x${string}`) : `0x${key}`);
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

  return { account, walletClient, publicClient };
}
