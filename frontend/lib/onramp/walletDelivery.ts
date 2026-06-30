// frontend/lib/onramp/walletDelivery.ts
// Mainnet provider (STUB — no concrete on-ramp wired yet).
//
// Model: the user pays by card inside a fiat→crypto on-ramp widget (Stripe Crypto
// Onramp / Coinbase Onramp / Transak / MoonPay, etc.). The on-ramp handles KYC and
// conversion and DELIVERS real USDC on-chain to our treasury wallet. We then
// confirm the on-chain Transfer and credit the DB — reusing the verification that
// /api/treasury/deposit-crypto already does (find a USDC Transfer to the treasury
// by txHash, match amount, mark CONFIRMED). Because the credit is backed by real
// USDC, claims pay out for real.
//
// Arc caveat: if the chosen on-ramp can't deliver directly to Arc mainnet, deliver
// USDC on a supported chain (Base/Ethereum) and bridge to Arc via Circle CCTP
// before crediting. That bridge step would slot in here, between delivery and
// confirm.
//
// To make this real, pick a provider and fill in createTopUp (widget/session) and
// confirm (verify the delivered/bridged USDC), then set ONRAMP_MODE=wallet-delivery
// with the mainnet config below.

import {
  OnrampNotConfiguredError,
  type OnrampProvider,
  type SettlementResult,
  type TopUpRequest,
  type TopUpSession,
} from "./types";

export interface WalletDeliveryConfig {
  /** Treasury wallet that receives delivered USDC. */
  treasuryAddress: string;
  /** Mainnet chain id where USDC is credited (e.g. Arc mainnet). */
  chainId: number;
  /** Mainnet USDC token address. */
  usdcAddress: string;
}

export function createWalletDeliveryOnramp(
  config: Partial<WalletDeliveryConfig>
): OnrampProvider {
  function requireConfig(): WalletDeliveryConfig {
    const { treasuryAddress, chainId, usdcAddress } = config;
    if (!treasuryAddress || !chainId || !usdcAddress) {
      throw new OnrampNotConfiguredError(
        "wallet-delivery onramp: set ONRAMP_TREASURY_ADDRESS, ONRAMP_CHAIN_ID and ONRAMP_USDC_ADDRESS, and wire a concrete provider."
      );
    }
    return { treasuryAddress, chainId, usdcAddress };
  }

  return {
    id: "wallet-delivery",
    mode: "wallet-delivery",
    backedOnChain: true,

    async createTopUp(_req: TopUpRequest): Promise<TopUpSession> {
      const cfg = requireConfig();
      // TODO(provider): create the on-ramp widget/session with
      //   destinationWallet = cfg.treasuryAddress, asset = USDC, chain = cfg.chainId
      // and return its checkoutUrl/sessionId.
      throw new OnrampNotConfiguredError(
        "wallet-delivery onramp: createTopUp not implemented — no provider wired yet."
      );
      // Shape once implemented:
      // return { provider: "<provider>", checkoutUrl, sessionId,
      //          destinationWallet: cfg.treasuryAddress, asset: "USDC", chainId: cfg.chainId };
    },

    async confirm(_payload: unknown): Promise<SettlementResult> {
      requireConfig();
      // TODO(provider): verify the delivered (and CCTP-bridged, if needed) USDC
      // Transfer to the treasury on-chain — reuse the logic in
      // app/api/treasury/deposit-crypto/route.ts — then return { amountUsdc, txHash }.
      throw new OnrampNotConfiguredError(
        "wallet-delivery onramp: confirm not implemented — no provider wired yet."
      );
    },
  };
}
