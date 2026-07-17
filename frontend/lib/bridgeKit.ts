// frontend/lib/bridgeKit.ts
// Circle Bridge Kit (CCTPv2) - lets a contributor claim their payout on a
// different chain than Arc, e.g. Base Sepolia, instead of the usual
// same-chain USDC transfer. Uses the same executor key as lib/executor.ts.

import { createPublicClient, fallback, http } from "viem";
import { BridgeKit, BridgeChain, type BridgeResult } from "@circle-fin/bridge-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";

// Destination chains a contributor can pick at claim time, beyond staying on Arc.
export const SUPPORTED_BRIDGE_CHAINS = {
  "base-sepolia": BridgeChain.Base_Sepolia,
} as const;

export type BridgeDestination = keyof typeof SUPPORTED_BRIDGE_CHAINS;

// Arc Testnet's default public RPC rate-limits under load; drpc.org is tried
// first, with the default endpoint as a fallback. Other chains use the SDK's
// built-in defaults.
const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_RPC_URLS = ["https://arc-testnet.drpc.org", "https://rpc.testnet.arc.network/"];

function getAdapter() {
  const key = process.env.EXECUTOR_PRIVATE_KEY;
  if (!key) throw new Error("Bridging is not configured (missing EXECUTOR_PRIVATE_KEY)");
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

/** Bridges `amount` (decimal USDC string, e.g. "12.5") from Arc Testnet to `to` on `destination`. */
export async function bridgeUsdcFromArc(
  destination: BridgeDestination,
  recipientAddress: string,
  amount: string
): Promise<{ txHash: string; result: BridgeResult }> {
  const kit = new BridgeKit();
  const adapter = getAdapter();

  const result = await kit.bridge({
    from: { adapter, chain: BridgeChain.Arc_Testnet },
    to: { adapter, chain: SUPPORTED_BRIDGE_CHAINS[destination], recipientAddress },
    amount,
  });

  if (result.state !== "success") {
    const failedStep = result.steps?.find((s) => s.state === "error");
    throw new Error(failedStep?.errorMessage ?? "Bridge transfer failed");
  }

  const mintStep = result.steps?.find((s) => s.name === "mint");
  if (!mintStep?.txHash) throw new Error("Bridge completed without a mint transaction hash");

  return { txHash: mintStep.txHash, result };
}
