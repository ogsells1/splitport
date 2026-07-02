// npx hardhat run scripts/createVault.ts --network arc
// Creates a new SplitVault via the factory and initializes it.
// Set VAULT_FACTORY_ADDRESS, USDC_ADDRESS, PROJECT_NAME, OWNER_ADDRESS in .env.

import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  const factoryAddress = process.env.VAULT_FACTORY_ADDRESS;
  const usdcAddress    = process.env.USDC_ADDRESS;
  const projectName    = process.env.PROJECT_NAME ?? "New Project";
  const ownerAddress   = process.env.OWNER_ADDRESS ?? deployer.address;

  if (!factoryAddress) throw new Error("VAULT_FACTORY_ADDRESS not set");
  if (!usdcAddress)    throw new Error("USDC_ADDRESS not set");

  const factory = await ethers.getContractAt("SplitVaultFactory", factoryAddress);

  console.log("Creating vault for owner:", ownerAddress);
  const tx = await factory.createVault(ownerAddress);
  const receipt = await tx.wait();

  // Parse VaultCreated event to get vault address
  const iface = (await ethers.getContractFactory("SplitVaultFactory")).interface;
  const vaultAddress = receipt.logs
    .map((log: any) => { try { return iface.parseLog(log); } catch { return null; } })
    .find((e: any) => e?.name === "VaultCreated")?.args.vault as string;

  if (!vaultAddress) throw new Error("VaultCreated event not found in receipt");
  console.log("✅ SplitVault created at:", vaultAddress);

  // Initialize the vault (wallets/percentages/roles must be set via env or edited below)
  const wallets     = (process.env.WALLETS     ?? "").split(",").filter(Boolean);
  const percentages = (process.env.PERCENTAGES ?? "").split(",").filter(Boolean).map(Number);
  const roles       = (process.env.ROLES       ?? "").split(",").filter(Boolean);

  if (wallets.length > 0) {
    const vault = await ethers.getContractAt("SplitVault", vaultAddress);
    const initTx = await vault.initialize(projectName, usdcAddress, wallets, percentages, roles);
    await initTx.wait();
    console.log("✅ Vault initialized. Tx:", initTx.hash);
  } else {
    console.log("ℹ️  WALLETS not set — vault not initialized. Call initialize() manually.");
  }

  console.log("\nAdd to .env or DB:  CONTRACT_ADDRESS=" + vaultAddress);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
