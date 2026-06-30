// frontend/lib/onramp/simulated.ts
// Testnet provider: a card payment credits the DB only (1 USD = 1 USDC), no real
// USDC moves on-chain. This mirrors the current behavior — the live Stripe routes
// (/api/treasury/checkout + /webhook) implement exactly this. Kept as a provider
// so the mainnet swap is a config change, not a rewrite.
//
// ⚠️ Credits from here are NOT backed by on-chain USDC. Claims of these funds only
// succeed while the executor wallet is separately funded (faucet on testnet).

import { parseUnits } from "viem";
import type { OnrampProvider, SettlementResult, TopUpRequest, TopUpSession } from "./types";

export const simulatedOnramp: OnrampProvider = {
  id: "simulated",
  mode: "simulated",
  backedOnChain: false,

  async createTopUp(req: TopUpRequest): Promise<TopUpSession> {
    // In the live flow this is the Stripe Checkout session created by
    // /api/treasury/checkout. The abstraction just records intent; the existing
    // route stays the source of truth until the mainnet provider is wired.
    return { provider: "simulated", sessionId: undefined };
  },

  async confirm(payload: unknown): Promise<SettlementResult> {
    // The live Stripe webhook already extracts the paid amount and credits the DB.
    // Here we normalize a { amountUsd, sessionId } shape to a USDC settlement.
    const { amountUsd, sessionId } = (payload ?? {}) as {
      amountUsd?: number;
      sessionId?: string;
    };
    const amount = Number(amountUsd);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("simulated onramp: invalid amountUsd in confirm payload");
    }
    // Testnet peg: 1 USD = 1 USDC.
    return { amountUsdc: parseUnits(String(amount), 6), externalId: sessionId };
  },
};
