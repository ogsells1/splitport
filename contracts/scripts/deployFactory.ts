import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying factory with account:", deployer.address);

  const Factory = await ethers.getContractFactory("SplitVaultFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  const address = await factory.getAddress();
  console.log("\n✅ SplitVaultFactory deployed to:", address);
  console.log("Explorer: https://testnet.arcscan.app/address/" + address);
  console.log("\nAdd to .env:  VAULT_FACTORY_ADDRESS=" + address);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
