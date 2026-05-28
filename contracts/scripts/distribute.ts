import { ethers } from "hardhat";

const VAULT_ADDRESS = "0x2DB3dbDA6C5F5CfF3234CDBadD049D90412c1774";
const USDC_ADDRESS  = "0x3600000000000000000000000000000000000000";

const VAULT_ABI = [
  "function distribute() external",
  "function pendingBalance() view returns (uint256)",
  "function getContributors() view returns (tuple(address wallet,uint256 percentage,uint256 totalPaid,string role,bool active)[])",
];
const USDC_ABI = ["function balanceOf(address) view returns (uint256)"];

async function main() {
  const [signer] = await ethers.getSigners();
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);
  const usdc  = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);

  const pending = await vault.pendingBalance();
  console.log(`\nPending to distribute: ${ethers.formatUnits(pending, 6)} USDC`);

  const contributors = await vault.getContributors();
  console.log("\nБалансы ДО:");
  for (const c of contributors) {
    const bal = await usdc.balanceOf(c.wallet);
    console.log(`  ${c.wallet}  [${c.role}]  ${ethers.formatUnits(bal, 6)} USDC`);
  }

  console.log("\nDistributing...");
  const tx = await vault.distribute();
  await tx.wait();
  console.log("✅ Done!\n");

  console.log("Балансы ПОСЛЕ:");
  for (const c of contributors) {
    const bal = await usdc.balanceOf(c.wallet);
    console.log(`  ${c.wallet}  [${c.role}]  ${ethers.formatUnits(bal, 6)} USDC`);
  }
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
