// frontend/lib/onramp/types.ts
// Provider-agnostic model for turning a fiat top-up into a treasury credit.
//
// The whole point of the abstraction: on testnet a card payment only credits a
// number in the DB (no real USDC moves). On mainnet a card payment must end with
// real USDC landing on-chain in the treasury wallet, otherwise claims can't pay
// out. Both flows produce the same end state – a CONFIRMED treasury deposit – so
// distribute/claim logic stays identical; only how the money arrives differs.

export type OnrampMode = "simulated" | "wallet-delivery";

export interface TopUpRequest {
  /** Internal user id (treasury owner). */
  userId: string;
  /** Fiat amount the user is paying, in USD. */
  amountUsd: number;
}

export interface TopUpSession {
  provider: string;
  /** Hosted checkout / widget URL to send the user to, if the provider uses one. */
  checkoutUrl?: string;
  /** Provider session id, for correlating the later confirmation. */
  sessionId?: string;
  /** Wallet-delivery onramps need a destination + expected asset/chain. */
  destinationWallet?: string;
  asset?: "USDC";
  chainId?: number;
}

export interface SettlementResult {
  /** USDC (6 decimals) to credit to the treasury. */
  amountUsdc: bigint;
  /** On-chain proof for wallet-delivery / CCTP settlements. */
  txHash?: string;
  /** Provider charge/session id for simulated settlements. */
  externalId?: string;
}

export interface OnrampProvider {
  readonly id: string;
  readonly mode: OnrampMode;
  /**
   * Whether credits from this provider are backed by real on-chain USDC in the
   * treasury. `false` for the simulated testnet provider (DB-only), so claims of
   * those funds depend on the executor being separately funded.
   */
  readonly backedOnChain: boolean;

  /** Start a top-up; returns a redirect/widget session or delivery target. */
  createTopUp(req: TopUpRequest): Promise<TopUpSession>;

  /**
   * Confirm a top-up from the provider's webhook/callback payload and return the
   * amount of USDC to credit. Implementations must be idempotent at the call site
   * (dedupe by sessionId/txHash) – see the existing Stripe webhook + deposit-crypto
   * routes for the dedupe pattern.
   */
  confirm(payload: unknown): Promise<SettlementResult>;
}

export class OnrampNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnrampNotConfiguredError";
  }
}
