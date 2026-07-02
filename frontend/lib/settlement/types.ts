export interface ShareLine {
  contributorId: string;
  wallet: string | null;
  amount: bigint;
}

export interface SettlementProvider {
  readonly mode: "custodial" | "onchain";

  /** Available USDC balance for a project's treasury (6 decimals).
   *  Custodial: sums DB deposits for ownerId. Vault: reads on-chain vault balance. */
  availableBalance(ownerId: string, contractAddress?: string): Promise<bigint>;

  /** Execute a distribution and return the new distribution's id.
   *  contractAddress is required in vault mode. */
  settleDistribution(
    projectId: string,
    shares: ShareLine[],
    total: bigint,
    contractAddress?: string
  ): Promise<{ distributionId: string; txHash?: string }>;

  /** A contributor claims everything owed to their wallet.
   *  contractAddress is required in vault mode (identifies which vault to claim from). */
  settleClaim(wallet: string, contractAddress?: string): Promise<{
    txHash: string;
    gross: bigint;
    fee: bigint;
    net: bigint;
  }>;
}
