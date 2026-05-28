import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying with account:", deployer.address);
  console.log(
    "Balance:",
    ethers.formatUnits(
      await deployer.provider.getBalance(deployer.address), 6
    ),
    "USDC"
  );

  // 1. Deploy SplitVault
  const SplitVault = await ethers.getContractFactory("SplitVault");
  const vault = await SplitVault.deploy(deployer.address);
  await vault.waitForDeployment();

  const vaultAddress = await vault.getAddress();
  console.log("\n✅ SplitVault deployed to:", vaultAddress);

  // 2. Optionally initialize right away
  // Get USDC address for Arc Testnet at https://faucet.circle.com
  const USDC_ADDRESS = process.env.USDC_ADDRESS;
  if (!USDC_ADDRESS) {
    console.log("\n⚠️  USDC_ADDRESS not set — skipping initialize().");
    console.log("   Set USDC_ADDRESS=0x... in .env and re-run, or call initialize() manually.");
    printSummary(vaultAddress, null);
    return;
  }

  // Edit wallets / percentages / roles to match your project
  const wallets      = [
    deployer.address,                                      // artist   50%
    "0xREPLACE_PRODUCER_WALLET",                           // producer 30%
    "0xREPLACE_LABEL_WALLET",                              // label    20%
  ];
  const percentages  = [5000, 3000, 2000]; // basis points — MUST sum to 10000
  const roles        = ["artist", "producer", "label"];

  console.log("\nInitializing vault...");
  const tx = await vault.initialize(
    "My Music Project",
    USDC_ADDRESS,
    wallets,
    percentages,
    roles
  );
  await tx.wait();
  console.log("✅ Vault initialized. Tx:", tx.hash);

  printSummary(vaultAddress, USDC_ADDRESS);
}

function printSummary(vaultAddress: string, usdcAddress: string | null) {
  console.log("\n═══════════════════════════════════════════");
  console.log("DEPLOYMENT SUMMARY");
  console.log("═══════════════════════════════════════════");
  console.log("Network:    Arc Testnet (chainId 5042002)");
  console.log("SplitVault:", vaultAddress);
  if (usdcAddress) console.log("USDC:      ", usdcAddress);
  console.log(
    "Explorer:   https://testnet.arcscan.app/address/" + vaultAddress
  );
  console.log("═══════════════════════════════════════════");
  console.log("\nAdd to .env:  CONTRACT_ADDRESS=" + vaultAddress);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
