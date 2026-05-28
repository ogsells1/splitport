import { ethers } from "hardhat";

const VAULT_ADDRESS = "0x690b71Fe67235a94bad81A4D204e79e09D63d550";
const USDC_ADDRESS  = "0x3600000000000000000000000000000000000000";

const VAULT_ABI = [
  "function owner() view returns (address)",
  "function initialized() view returns (bool)",
  "function initialize(string,address,address[],uint256[],string[]) external",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`\nSigner (твой ключ):  ${signer.address}`);

  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);

  const owner: string = await vault.owner();
  console.log(`Contract owner:      ${owner}`);
  console.log(`initialized:         ${await vault.initialized()}`);

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    console.log(`\n❌  Ты НЕ owner контракта!`);
    console.log(`    Нужен приватный ключ от: ${owner}`);
    console.log(`    В .env сейчас ключ от:   ${signer.address}`);
    return;
  }

  console.log(`\n✅  Ты owner — пробуем initialize()...`);

  // Минимальный тест — один участник 100%
  try {
    const tx = await vault.initialize(
      "BYN Test",
      USDC_ADDRESS,
      [signer.address],
      [10000n],
      ["label"],
      { gasLimit: 500_000n }
    );
    console.log(`tx: ${tx.hash}`);
    await tx.wait();
    console.log("✅  initialize() успешно!");
  } catch (e: any) {
    console.log(`\n❌  Revert detail: ${e.message}`);
    // Попробуем статический вызов для получения причины
    try {
      await vault.initialize.staticCall(
        "BYN Test",
        USDC_ADDRESS,
        [signer.address],
        [10000n],
        ["label"]
      );
    } catch (se: any) {
      console.log(`    Static call error: ${se.message}`);
    }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
