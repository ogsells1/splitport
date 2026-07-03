import { ethers } from "hardhat";
import { syncProjectToDb } from "./lib/syncDb";

// ─── CONFIG ────────────────────────────────────────────────────────────────────

const VAULT_ADDRESS  = "0x2DB3dbDA6C5F5CfF3234CDBadD049D90412c1774";
const USDC_ADDRESS   = "0x3600000000000000000000000000000000000000";
const PROJECT_NAME   = "SplitPort — Demo Project";

/**
 * Участники: адрес, basis points (сумма = 10000), роль.
 *
 * Замени адреса на реальные Privy / Circle кошельки.
 * Пока используем тестовые адреса — deployer получит всё при distribute().
 */
const CONTRIBUTORS: { wallet: string; bps: number; role: string }[] = [
  {
    wallet: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf", // deployer (label)
    bps: 5000,
    role: "label",
  },
  {
    wallet: "0xc35D19Ba49177710265f90aAE2ACcEd3bEbB8645", // тестовый кошелёк
    bps: 3000,
    role: "artist",
  },
  {
    wallet: "0x000000000000000000000000000000000000dEaD", // заглушка — замени!
    bps: 2000,
    role: "producer",
  },
];

// ─── VALIDATION ────────────────────────────────────────────────────────────────

function validateContributors() {
  const total = CONTRIBUTORS.reduce((acc, c) => acc + c.bps, 0);
  if (total !== 10000) {
    throw new Error(`Сумма basis points = ${total}, должна быть 10000`);
  }
  const wallets = CONTRIBUTORS.map((c) => c.wallet.toLowerCase());
  if (new Set(wallets).size !== wallets.length) {
    throw new Error("Дублирующиеся адреса участников");
  }
  CONTRIBUTORS.forEach((c) => {
    if (!ethers.isAddress(c.wallet)) {
      throw new Error(`Невалидный адрес: ${c.wallet}`);
    }
    if (c.bps <= 0 || c.bps > 10000) {
      throw new Error(`Невалидный bps=${c.bps} для ${c.wallet}`);
    }
  });
}

// ─── ABI (только нужные функции) ───────────────────────────────────────────────

const VAULT_ABI = [
  "function initialized() view returns (bool)",
  "function initialize(string,address,address[],uint256[],string[]) external",
  "function getProjectInfo() view returns (tuple(string name,address usdcToken,uint256 totalDeposited,uint256 totalDistributed,uint256 pendingBalance,bool initialized,bool paused,uint256 contributorCount))",
  "function getContributors() view returns (tuple(address wallet,uint256 percentage,uint256 totalPaid,string role,bool active)[])",
];

// ─── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🚀  SplitPort SplitVault — Initialize\n");

  // --- Validate config ---
  validateContributors();
  console.log(`✅  Config OK — ${CONTRIBUTORS.length} участников, сумма BPS = 10000`);

  // --- Signer ---
  const [deployer] = await ethers.getSigners();
  console.log(`👛  Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰  Balance: ${ethers.formatUnits(balance, 6)} USDC (gas token)\n`);

  // --- Attach to vault ---
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, deployer);

  // --- Check already initialized ---
  const isInitialized: boolean = await vault.initialized();
  if (isInitialized) {
    console.log("⚠️   Vault уже инициализирован. Читаем текущее состояние...\n");
    await printState(vault);
    await syncProjectToDb({
      name: PROJECT_NAME,
      contractAddress: VAULT_ADDRESS,
      usdcAddress: USDC_ADDRESS,
      contributors: CONTRIBUTORS,
    });
    return;
  }

  // --- Prepare args ---
  const wallets    = CONTRIBUTORS.map((c) => c.wallet);
  const bpsArr     = CONTRIBUTORS.map((c) => BigInt(c.bps));
  const roles      = CONTRIBUTORS.map((c) => c.role);

  console.log("📋  Участники:");
  CONTRIBUTORS.forEach((c) =>
    console.log(`    ${c.wallet}  ${(c.bps / 100).toFixed(0)}%  [${c.role}]`)
  );
  console.log();

  // --- Send tx ---
  console.log("📡  Отправляем initialize()...");
  const tx = await vault.initialize(
    PROJECT_NAME,
    USDC_ADDRESS,
    wallets,
    bpsArr,
    roles
  );
  console.log(`    tx: ${tx.hash}`);
  console.log("    Ожидаем подтверждения...");

  const receipt = await tx.wait();
  console.log(`\n✅  Confirmed! Block: ${receipt.blockNumber}  Gas: ${receipt.gasUsed}\n`);

  // --- Print final state ---
  await printState(vault);

  // --- Sync to DB ---
  await syncProjectToDb({
    name: PROJECT_NAME,
    contractAddress: VAULT_ADDRESS,
    usdcAddress: USDC_ADDRESS,
    deployBlock: receipt.blockNumber,
    contributors: CONTRIBUTORS,
  });
}

async function printState(vault: ethers.Contract) {
  const info = await vault.getProjectInfo();
  console.log("─── Project Info ───────────────────────────────");
  console.log(`  Name:              ${info.name}`);
  console.log(`  USDC token:        ${info.usdcToken}`);
  console.log(`  Initialized:       ${info.initialized}`);
  console.log(`  Paused:            ${info.paused}`);
  console.log(`  Total deposited:   ${ethers.formatUnits(info.totalDeposited, 6)} USDC`);
  console.log(`  Total distributed: ${ethers.formatUnits(info.totalDistributed, 6)} USDC`);
  console.log(`  Pending balance:   ${ethers.formatUnits(info.pendingBalance, 6)} USDC`);
  console.log(`  Contributors:      ${info.contributorCount}`);

  const contributors = await vault.getContributors();
  console.log("\n─── Contributors ───────────────────────────────");
  contributors.forEach(
    (c: { wallet: string; percentage: bigint; totalPaid: bigint; role: string; active: boolean }) => {
      console.log(
        `  ${c.wallet}  ${(Number(c.percentage) / 100).toFixed(0)}%  [${c.role}]` +
        `  paid=${ethers.formatUnits(c.totalPaid, 6)} USDC  active=${c.active}`
      );
    }
  );
  console.log("────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("\n❌  Error:", err.message ?? err);
  process.exit(1);
});
