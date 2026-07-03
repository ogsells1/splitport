// VaultSettlement - on-chain settlement via per-project SplitVault contracts.
// Selected when CUSTODY_MODE=onchain.

import { getAddress, isAddress, type Address } from "viem";
import { prisma } from "@/lib/prisma";
import { getExecutor } from "@/lib/executor";
import { USDC_ADDRESS, VAULT_ABI } from "@/lib/contract";
import type { SettlementProvider, ShareLine } from "./types";

export class VaultSettlement implements SettlementProvider {
  readonly mode = "onchain" as const;

  /** On-chain balance of the project's SplitVault. */
  async availableBalance(_ownerId: string, contractAddress?: string): Promise<bigint> {
    // In vault mode we pass contractAddress via a side-channel; the caller
    // (runDistribution) must supply it.  The signature matches the interface
    // by keeping ownerId as first arg (unused here).
    if (!contractAddress || !isAddress(contractAddress)) {
      throw new Error("VaultSettlement.availableBalance: contractAddress required");
    }
    const executor = this._requireExecutor();
    const balance = (await executor.publicClient.readContract({
      address: getAddress(USDC_ADDRESS) as Address,
      abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "balanceOf",
      args: [getAddress(contractAddress) as Address],
    })) as bigint;
    return balance;
  }

  /**
   * Execute distribution on-chain via SplitVault.payEach(), then record in DB.
   * contractAddress must be the vault's real 0x address (set on the project).
   */
  async settleDistribution(
    projectId: string,
    shares: ShareLine[],
    total: bigint,
    contractAddress?: string
  ): Promise<{ distributionId: string; txHash?: string }> {
    if (!contractAddress || !isAddress(contractAddress)) {
      throw new Error("VaultSettlement.settleDistribution: contractAddress required");
    }

    const walleted = shares.filter((s) => s.wallet && isAddress(s.wallet));
    if (walleted.length === 0) throw new Error("No wallet-linked contributors to settle");

    const executor = this._requireExecutor();
    const vault = getAddress(contractAddress) as Address;

    const recipients = walleted.map((s) => getAddress(s.wallet!) as Address);
    const amounts    = walleted.map((s) => s.amount);

    // accrue into the vault's claimable mapping (pull model - participants call claimFor)
    const txHash = await executor.walletClient.writeContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: "accrue",
      args: [recipients, amounts],
    });
    await executor.publicClient.waitForTransactionReceipt({ hash: txHash });

    // Record in DB - payouts are PENDING until claimed
    const distributionId = await prisma.$transaction(async (tx) => {
      const distribution = await tx.distribution.create({
        data: { projectId, total },
      });
      await tx.payout.createMany({
        data: shares.map((s) => ({
          distributionId: distribution.id,
          projectId,
          contributorId: s.contributorId,
          wallet: s.wallet,
          amount: s.amount,
          status: "PENDING",
        })),
      });
      return distribution.id;
    });

    return { distributionId, txHash };
  }

  /**
   * Executor triggers claimFor(wallet) on the vault - funds go directly to the
   * participant's wallet. Non-custodial: executor can't change the destination.
   */
  async settleClaim(wallet: string, contractAddress?: string): Promise<{
    txHash: string;
    gross: bigint;
    fee: bigint;
    net: bigint;
  }> {
    if (!contractAddress || !isAddress(contractAddress)) {
      throw new Error("VaultSettlement.settleClaim: contractAddress required");
    }
    if (!isAddress(wallet)) throw new Error("Invalid wallet address");

    const executor = this._requireExecutor();
    const vault = getAddress(contractAddress) as Address;
    const walletAddr = getAddress(wallet) as Address;

    // Read claimable balance before executing so we can return it.
    const gross = (await executor.publicClient.readContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: "claimable",
      args: [walletAddr],
    })) as bigint;
    if (gross === 0n) throw new Error("Nothing to claim");

    const txHash = await executor.walletClient.writeContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: "claimFor",
      args: [walletAddr],
    });
    await executor.publicClient.waitForTransactionReceipt({ hash: txHash });

    // No fee deducted - gas on Arc is USDC paid by the executor, not by the participant.
    return { txHash, gross, fee: 0n, net: gross };
  }

  private _requireExecutor() {
    const executor = getExecutor();
    if (!executor) throw new Error("EXECUTOR_PRIVATE_KEY not set");
    return executor;
  }
}
