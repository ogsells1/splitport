import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

/**
 * Тесты для SplitVault
 * Запуск: npx hardhat test
 */

// Минимальный ERC20 для тестов (мокаем USDC)
const MockUSDC_ABI = [
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
];

describe("SplitVault", function () {
  // ── Fixture ────────────────────────────────────────────────────────────

  async function deployFixture() {
    const [owner, artist, producer, label, stranger] = await ethers.getSigners();

    // Деплоим mock USDC (ERC20 с mint)
    const MockToken = await ethers.getContractFactory("MockERC20");
    const usdc = await MockToken.deploy("USD Coin", "USDC", 6);
    const usdcAddress = await usdc.getAddress();

    // Деплоим SplitVault
    const SplitVault = await ethers.getContractFactory("SplitVault");
    const vault = await SplitVault.deploy(owner.address);
    const vaultAddress = await vault.getAddress();

    // Параметры участников (50 / 30 / 20)
    const wallets     = [artist.address, producer.address, label.address];
    const percentages = [5000, 3000, 2000];
    const roles       = ["artist", "producer", "label"];

    return { vault, usdc, vaultAddress, usdcAddress, owner, artist, producer, label, stranger, wallets, percentages, roles };
  }

  async function initializedFixture() {
    const f = await loadFixture(deployFixture);
    await f.vault.initialize(
      "Test Project",
      f.usdcAddress,
      f.wallets,
      f.percentages,
      f.roles
    );
    return f;
  }

  // ── Deploy ─────────────────────────────────────────────────────────────

  describe("Deploy", function () {
    it("owner задан корректно", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("не инициализирован после деплоя", async function () {
      const { vault } = await loadFixture(deployFixture);
      expect(await vault.initialized()).to.equal(false);
    });
  });

  // ── Initialize ─────────────────────────────────────────────────────────

  describe("initialize()", function () {
    it("успешная инициализация", async function () {
      const { vault, usdcAddress, wallets, percentages, roles } = await loadFixture(deployFixture);

      await expect(vault.initialize("My Project", usdcAddress, wallets, percentages, roles))
        .to.emit(vault, "Initialized")
        .and.to.emit(vault, "ContributorAdded");

      expect(await vault.initialized()).to.equal(true);
      expect(await vault.projectName()).to.equal("My Project");
    });

    it("нельзя инициализировать дважды", async function () {
      const { vault, usdcAddress, wallets, percentages, roles } = await loadFixture(deployFixture);
      await vault.initialize("P", usdcAddress, wallets, percentages, roles);
      await expect(vault.initialize("P", usdcAddress, wallets, percentages, roles))
        .to.be.revertedWithCustomError(vault, "AlreadyInitialized");
    });

    it("revert если сумма basis points != 10000", async function () {
      const { vault, usdcAddress, wallets, roles } = await loadFixture(deployFixture);
      await expect(vault.initialize("P", usdcAddress, wallets, [4000, 3000, 2000], roles))
        .to.be.revertedWithCustomError(vault, "PercentageSumExceeds10000");
    });

    it("revert если адрес USDC нулевой", async function () {
      const { vault, wallets, percentages, roles } = await loadFixture(deployFixture);
      await expect(vault.initialize("P", ethers.ZeroAddress, wallets, percentages, roles))
        .to.be.revertedWithCustomError(vault, "InvalidAddress");
    });

    it("только owner может инициализировать", async function () {
      const { vault, usdcAddress, wallets, percentages, roles, stranger } = await loadFixture(deployFixture);
      await expect(vault.connect(stranger).initialize("P", usdcAddress, wallets, percentages, roles))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  // ── depositRevenue ─────────────────────────────────────────────────────

  describe("depositRevenue()", function () {
    it("успешный депозит", async function () {
      const { vault, usdc, vaultAddress, owner } = await loadFixture(initializedFixture);

      const amount = ethers.parseUnits("1000", 6); // 1000 USDC
      await usdc.mint(owner.address, amount);
      await usdc.approve(vaultAddress, amount);

      await expect(vault.depositRevenue(amount))
        .to.emit(vault, "RevenueDeposited")
        .withArgs(owner.address, amount, await getTimestamp());

      expect(await vault.totalDeposited()).to.equal(amount);
    });

    it("revert при amount = 0", async function () {
      const { vault } = await loadFixture(initializedFixture);
      await expect(vault.depositRevenue(0))
        .to.be.revertedWithCustomError(vault, "ZeroAmount");
    });
  });

  // ── distribute ─────────────────────────────────────────────────────────

  describe("distribute()", function () {
    it("корректное распределение 50/30/20", async function () {
      const { vault, usdc, vaultAddress, owner, artist, producer, label } = await loadFixture(initializedFixture);

      const amount = ethers.parseUnits("1000", 6); // 1000 USDC
      await usdc.mint(owner.address, amount);
      await usdc.approve(vaultAddress, amount);
      await vault.depositRevenue(amount);

      await expect(vault.distribute())
        .to.emit(vault, "RevenueDistributed");

      // Artist: 50% = 500 USDC
      expect(await usdc.balanceOf(artist.address)).to.equal(ethers.parseUnits("500", 6));
      // Producer: 30% = 300 USDC
      expect(await usdc.balanceOf(producer.address)).to.equal(ethers.parseUnits("300", 6));
      // Label: 20% = 200 USDC
      expect(await usdc.balanceOf(label.address)).to.equal(ethers.parseUnits("200", 6));

      // Vault пуст
      expect(await usdc.balanceOf(vaultAddress)).to.equal(0);
    });

    it("totalDistributed обновляется", async function () {
      const { vault, usdc, vaultAddress, owner } = await loadFixture(initializedFixture);
      const amount = ethers.parseUnits("500", 6);
      await usdc.mint(owner.address, amount);
      await usdc.approve(vaultAddress, amount);
      await vault.depositRevenue(amount);
      await vault.distribute();
      expect(await vault.totalDistributed()).to.equal(amount);
    });

    it("revert если нечего распределять", async function () {
      const { vault } = await loadFixture(initializedFixture);
      await expect(vault.distribute())
        .to.be.revertedWithCustomError(vault, "NothingToDistribute");
    });
  });

  // ── previewShare ───────────────────────────────────────────────────────

  describe("previewShare()", function () {
    it("верный preview для artist (50%)", async function () {
      const { vault, usdc, vaultAddress, owner, artist } = await loadFixture(initializedFixture);
      const amount = ethers.parseUnits("1000", 6);
      await usdc.mint(owner.address, amount);
      await usdc.approve(vaultAddress, amount);
      await vault.depositRevenue(amount);

      const preview = await vault.previewShare(artist.address);
      expect(preview).to.equal(ethers.parseUnits("500", 6));
    });
  });

  // ── Pause / EmergencyWithdraw ──────────────────────────────────────────

  describe("pause / emergencyWithdraw", function () {
    it("pause блокирует deposit", async function () {
      const { vault, owner } = await loadFixture(initializedFixture);
      await vault.pause();
      await expect(vault.depositRevenue(1))
        .to.be.revertedWithCustomError(vault, "EnforcedPause");
    });

    it("emergencyWithdraw возвращает средства owner", async function () {
      const { vault, usdc, vaultAddress, owner } = await loadFixture(initializedFixture);
      const amount = ethers.parseUnits("1000", 6);
      await usdc.mint(owner.address, amount);
      await usdc.approve(vaultAddress, amount);
      await vault.depositRevenue(amount);

      await vault.pause();
      const before = await usdc.balanceOf(owner.address);
      await vault.emergencyWithdraw(owner.address);
      const after = await usdc.balanceOf(owner.address);

      expect(after - before).to.equal(amount);
    });
  });

  // ── getContributors ────────────────────────────────────────────────────

  describe("getContributors()", function () {
    it("возвращает правильный список", async function () {
      const { vault, wallets, percentages } = await loadFixture(initializedFixture);
      const list = await vault.getContributors();
      expect(list.length).to.equal(3);
      expect(list[0].wallet).to.equal(wallets[0]);
      expect(list[0].percentage).to.equal(percentages[0]);
      expect(list[0].role).to.equal("artist");
    });
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block!.timestamp;
}
