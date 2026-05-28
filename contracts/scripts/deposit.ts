import { ethers } from "hardhat";

const VAULT_ADDRESS = "0x2DB3dbDA6C5F5CfF3234CDBadD049D90412c1774";
const USDC_ADDRESS  = "0x3600000000000000000000000000000000000000";
const AMOUNT_USDC   = "10"; // сколько USDC задепозитить

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];
const VAULT_ABI = [
  "function depositRevenue(uint256 amount) external",
  "function pendingBalance() view returns (uint256)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const amount = ethers.parseUnits(AMOUNT_USDC, 6);

  const usdc  = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);

  const bal = await usdc.balanceOf(signer.address);
  console.log(`Balance: ${ethers.formatUnits(bal, 6)} USDC`);

  console.log(`Approving ${AMOUNT_USDC} USDC...`);
  const approveTx = await usdc.approve(VAULT_ADDRESS, amount);
  await approveTx.wait();
  console.log("✅ Approved");

  console.log(`Depositing...`);
  const depositTx = await vault.depositRevenue(amount);
  await depositTx.wait();
  console.log("✅ Deposited!");

  const pending = await vault.pendingBalance();
  console.log(`Pending in vault: ${ethers.formatUnits(pending, 6)} USDC`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
