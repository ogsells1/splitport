import { ethers } from "hardhat";

const VAULT_ADDRESS = "0x2DB3dbDA6C5F5CfF3234CDBadD049D90412c1774";

const VAULT_ABI = [
  "function replaceContributors(address[],uint256[],string[]) external",
  "function getContributors() view returns (tuple(address wallet,uint256 percentage,uint256 totalPaid,string role,bool active)[])",
  "function pendingBalance() view returns (uint256)",
  "function distribute() external",
];

// ─── НОВЫЕ УЧАСТНИКИ ────────────────────────────────────────────────────────
const NEW_CONTRIBUTORS = [
  {
    wallet: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
    bps: 5000,
    role: "label",
  },
  {
    wallet: "0xc35D19Ba49177710265f90aAE2ACcEd3bEbB8645",
    bps: 3000,
    role: "artist",
  },
  {
    wallet: "0x80bdCE0557714834fF509C055C062f55C14E8626", // реальный продюсер
    bps: 2000,
    role: "producer",
  },
];

async function main() {
  console.log("\n🔄  BYN SplitVault — Replace Contributors\n");

  // Валидация
  const total = NEW_CONTRIBUTORS.reduce((acc, c) => acc + c.bps, 0);
  if (total !== 10000) throw new Error(`Сумма BPS = ${total}, должна быть 10000`);

  const [deployer] = await ethers.getSigners();
  console.log(`👛  Signer: ${deployer.address}`);

  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, deployer);

  // 1. Проверяем pending баланс — если есть, сначала distribute()
  const pending = await vault.pendingBalance();
  console.log(`💰  Pending balance: ${ethers.formatUnits(pending, 6)} USDC`);

  if (pending > 0n) {
    console.log("\n⚠️   Есть pending USDC — сначала distribute()...");
    const dtx = await vault.distribute();
    await dtx.wait();
    console.log(`✅  distribute() выполнен. Tx: ${dtx.hash}`);
  }

  // 2. Показываем текущих участников
  const before = await vault.getContributors();
  console.log("\n─── Участники ДО ───────────────────────────────");
  before.forEach((c: any) =>
    console.log(`  ${c.wallet}  ${Number(c.percentage) / 100}%  [${c.role}]`)
  );

  // 3. replaceContributors()
  console.log("\n📡  Отправляем replaceContributors()...");
  const wallets = NEW_CONTRIBUTORS.map((c) => c.wallet);
  const bpsArr  = NEW_CONTRIBUTORS.map((c) => BigInt(c.bps));
  const roles   = NEW_CONTRIBUTORS.map((c) => c.role);

  const tx = await vault.replaceContributors(wallets, bpsArr, roles);
  console.log(`    tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`✅  Confirmed! Block: ${receipt.blockNumber}  Gas: ${receipt.gasUsed}`);

  // 4. Проверяем результат
  const after = await vault.getContributors();
  console.log("\n─── Участники ПОСЛЕ ────────────────────────────");
  after.forEach((c: any) =>
    console.log(`  ${c.wallet}  ${Number(c.percentage) / 100}%  [${c.role}]`)
  );
  console.log("────────────────────────────────────────────────\n");
  console.log("✅  Готово! 0xDead заменён на реального продюсера.\n");
}

main().catch((e) => {
  console.error("\n❌  Error:", e.message ?? e);
  process.exit(1);
});
