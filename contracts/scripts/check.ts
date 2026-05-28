import { ethers } from "hardhat";

const VAULT_ADDRESS = "0x690b71Fe67235a94bad81A4D204e79e09D63d550";

const VAULT_ABI = [
  "function initialized() view returns (bool)",
  "function projectName() view returns (string)",
  "function getProjectInfo() view returns (tuple(string name,address usdcToken,uint256 totalDeposited,uint256 totalDistributed,uint256 pendingBalance,bool initialized,bool paused,uint256 contributorCount))",
  "function getContributors() view returns (tuple(address wallet,uint256 percentage,uint256 totalPaid,string role,bool active)[])",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);

  const isInit: boolean = await vault.initialized();
  console.log(`\ninitialized: ${isInit}`);

  if (!isInit) {
    console.log("⚠️  Vault НЕ инициализирован — запускай initialize.ts");
    return;
  }

  const info = await vault.getProjectInfo();
  console.log("\n─── Project Info ────────────────────────────");
  console.log(`  name:              ${info.name}`);
  console.log(`  usdcToken:         ${info.usdcToken}`);
  console.log(`  totalDeposited:    ${ethers.formatUnits(info.totalDeposited, 6)} USDC`);
  console.log(`  totalDistributed:  ${ethers.formatUnits(info.totalDistributed, 6)} USDC`);
  console.log(`  pendingBalance:    ${ethers.formatUnits(info.pendingBalance, 6)} USDC`);
  console.log(`  paused:            ${info.paused}`);
  console.log(`  contributorCount:  ${info.contributorCount}`);

  const contributors = await vault.getContributors();
  console.log("\n─── Contributors ────────────────────────────");
  contributors.forEach(
    (c: { wallet: string; percentage: bigint; totalPaid: bigint; role: string; active: boolean }) => {
      console.log(
        `  ${c.wallet}  ${Number(c.percentage) / 100}%  [${c.role}]  paid=${ethers.formatUnits(c.totalPaid, 6)} USDC`
      );
    }
  );
  console.log("─────────────────────────────────────────────\n");
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
