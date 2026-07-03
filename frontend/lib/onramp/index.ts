// frontend/lib/onramp/index.ts
// Selects the active on-ramp provider from env. Defaults to the simulated testnet
// provider so current behavior is unchanged until a mainnet provider is wired.
//
//   ONRAMP_MODE=simulated            (default) - DB-only credit, testnet
//   ONRAMP_MODE=wallet-delivery      real on-ramp delivers USDC on-chain (mainnet)
//     requires: ONRAMP_TREASURY_ADDRESS, ONRAMP_CHAIN_ID, ONRAMP_USDC_ADDRESS

import { simulatedOnramp } from "./simulated";
import { createWalletDeliveryOnramp } from "./walletDelivery";
import type { OnrampProvider } from "./types";

export * from "./types";

export function getOnramp(): OnrampProvider {
  const mode = process.env.ONRAMP_MODE ?? "simulated";
  if (mode === "wallet-delivery") {
    return createWalletDeliveryOnramp({
      treasuryAddress: process.env.ONRAMP_TREASURY_ADDRESS,
      chainId: process.env.ONRAMP_CHAIN_ID ? Number(process.env.ONRAMP_CHAIN_ID) : undefined,
      usdcAddress: process.env.ONRAMP_USDC_ADDRESS,
    });
  }
  return simulatedOnramp;
}
