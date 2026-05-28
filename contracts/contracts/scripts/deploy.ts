import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const SplitVault = await ethers.getContractFactory("SplitVault");
  const vault = await SplitVault.deploy(deployer.address);
  await vault.waitForDeployment();

  const vaultAddress = await vault.getAddress();
  console.log("SplitVault deployed to:", vaultAddress);
  console.log("Add to .env:  CONTRACT_ADDRESS=" + vaultAddress);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
