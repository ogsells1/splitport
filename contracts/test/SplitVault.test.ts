import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("SplitVault", function () {
  // ── Fixtures ───────────────────────────────────────────────────────────

  async function deployFixture() {
    const [owner, artist, producer, label, stranger] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    const usdc = await MockToken.deploy("USD Coin", "USDC", 6);
    const usdcAddress = await usdc.getAddress();

    const SplitVault = await ethers.getContractFactory("SplitVault");
    const vault = await SplitVault.deploy(owner.address);
    const vaultAddress = await vault.getAddress();

    const wallets     = [artist.address, producer.address, label.address];
    const percentages = [5000, 3000, 2000];
    const roles       = ["artist", "producer", "label"];

    return { vault, usdc, vaultAddress, usdcAddress, owner, artist, producer, label, stranger, wallets, percentages, roles };
  }

  async function initializedFixture() {
    const f = await loadFixture(deployFixture);
    await f.vault.initialize("Test Project", f.usdcAddress, f.wallets, f.percentages, f.roles);
    return f;
  }

  async function fundedFixture() {
    const f = await loadFixture(initializedFixture);
    const amount = ethers.parseUnits("1000", 6);
    await f.usdc.mint(f.owner.address, amount);
    await f.usdc.approve(f.vaultAddress, amount);
    await f.vault.depositRevenue(amount);
    return { ...f, deposited: amount };
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
      const amount = ethers.parseUnits("1000", 6);
      await usdc.mint(owner.address, amount);
      await usdc.approve(vaultAddress, amount);
      await expect(vault.depositRevenue(amount)).to.emit(vault, "RevenueDeposited");
      expect(await vault.totalDeposited()).to.equal(amount);
    });

    it("revert при amount = 0", async function () {
      const { vault } = await loadFixture(initializedFixture);
      await expect(vault.depositRevenue(0)).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });
  });

  // ── distribute ─────────────────────────────────────────────────────────

  describe("distribute()", function () {
    it("корректное распределение 50/30/20", async function () {
      const { vault, usdc, artist, producer, label, vaultAddress } = await loadFixture(fundedFixture);
      await expect(vault.distribute()).to.emit(vault, "RevenueDistributed");
      expect(await usdc.balanceOf(artist.address)).to.equal(ethers.parseUnits("500", 6));
      expect(await usdc.balanceOf(producer.address)).to.equal(ethers.parseUnits("300", 6));
      expect(await usdc.balanceOf(label.address)).to.equal(ethers.parseUnits("200", 6));
      expect(await usdc.balanceOf(vaultAddress)).to.equal(0);
    });

    it("totalDistributed обновляется", async function () {
      const { vault, deposited } = await loadFixture(fundedFixture);
      await vault.distribute();
      expect(await vault.totalDistributed()).to.equal(deposited);
    });

    it("revert если нечего распределять", async function () {
      const { vault } = await loadFixture(initializedFixture);
      await expect(vault.distribute()).to.be.revertedWithCustomError(vault, "NothingToDistribute");
    });
  });

  describe("distributePartial()", function () {
    it("распределяет только указанную сумму, остаток остаётся в vault", async function () {
      const { vault, usdc, artist, producer, label, vaultAddress } = await loadFixture(fundedFixture);
      const partial = ethers.parseUnits("400", 6);
      await vault.distributePartial(partial);
      expect(await usdc.balanceOf(artist.address)).to.equal(ethers.parseUnits("200", 6));
      expect(await usdc.balanceOf(producer.address)).to.equal(ethers.parseUnits("120", 6));
      expect(await usdc.balanceOf(label.address)).to.equal(ethers.parseUnits("80", 6));
      expect(await usdc.balanceOf(vaultAddress)).to.equal(ethers.parseUnits("600", 6));
    });

    it("revert если сумма больше pending баланса", async function () {
      const { vault } = await loadFixture(fundedFixture);
      await expect(vault.distributePartial(ethers.parseUnits("2000", 6)))
        .to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });

    it("revert если сумма = 0", async function () {
      const { vault } = await loadFixture(initializedFixture);
      await expect(vault.distributePartial(0)).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });
  });

  // ── payEach ────────────────────────────────────────────────────────────

  describe("payEach()", function () {
    it("отправляет точные суммы каждому получателю", async function () {
      const { vault, usdc, artist, producer, vaultAddress } = await loadFixture(fundedFixture);
      const recipients = [artist.address, producer.address];
      const amounts    = [ethers.parseUnits("300", 6), ethers.parseUnits("200", 6)];

      await vault.payEach(recipients, amounts);

      expect(await usdc.balanceOf(artist.address)).to.equal(ethers.parseUnits("300", 6));
      expect(await usdc.balanceOf(producer.address)).to.equal(ethers.parseUnits("200", 6));
      // 500 USDC осталось в vault
      expect(await usdc.balanceOf(vaultAddress)).to.equal(ethers.parseUnits("500", 6));
    });

    it("totalDistributed обновляется", async function () {
      const { vault, artist, producer } = await loadFixture(fundedFixture);
      const amounts = [ethers.parseUnits("300", 6), ethers.parseUnits("200", 6)];
      await vault.payEach([artist.address, producer.address], amounts);
      expect(await vault.totalDistributed()).to.equal(ethers.parseUnits("500", 6));
    });

    it("revert если массивы разной длины", async function () {
      const { vault, artist } = await loadFixture(fundedFixture);
      await expect(vault.payEach([artist.address], []))
        .to.be.revertedWithCustomError(vault, "LengthMismatch");
    });

    it("revert если недостаточно баланса", async function () {
      const { vault, artist } = await loadFixture(fundedFixture);
      await expect(vault.payEach([artist.address], [ethers.parseUnits("9999", 6)]))
        .to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });

    it("только owner может вызывать", async function () {
      const { vault, artist, stranger } = await loadFixture(fundedFixture);
      await expect(vault.connect(stranger).payEach([artist.address], [ethers.parseUnits("100", 6)]))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  // ── accrue + claim + claimFor ──────────────────────────────────────────

  describe("accrue() + claim() + claimFor()", function () {
    it("accrue накапливает claimable баланс", async function () {
      const { vault, artist, producer } = await loadFixture(fundedFixture);
      const amounts = [ethers.parseUnits("500", 6), ethers.parseUnits("300", 6)];
      await vault.accrue([artist.address, producer.address], amounts);

      expect(await vault.claimable(artist.address)).to.equal(ethers.parseUnits("500", 6));
      expect(await vault.claimable(producer.address)).to.equal(ethers.parseUnits("300", 6));
    });

    it("accrue не переводит средства сразу", async function () {
      const { vault, usdc, artist, vaultAddress } = await loadFixture(fundedFixture);
      await vault.accrue([artist.address], [ethers.parseUnits("500", 6)]);
      // Деньги остаются в vault
      expect(await usdc.balanceOf(vaultAddress)).to.equal(ethers.parseUnits("1000", 6));
      expect(await usdc.balanceOf(artist.address)).to.equal(0);
    });

    it("claim() снимает весь баланс на себя", async function () {
      const { vault, usdc, artist } = await loadFixture(fundedFixture);
      const amount = ethers.parseUnits("500", 6);
      await vault.accrue([artist.address], [amount]);

      await vault.connect(artist).claim();

      expect(await usdc.balanceOf(artist.address)).to.equal(amount);
      expect(await vault.claimable(artist.address)).to.equal(0);
    });

    it("claim() обновляет totalDistributed", async function () {
      const { vault, artist } = await loadFixture(fundedFixture);
      const amount = ethers.parseUnits("500", 6);
      await vault.accrue([artist.address], [amount]);
      await vault.connect(artist).claim();
      expect(await vault.totalDistributed()).to.equal(amount);
    });

    it("claim() revert если нечего клеймить", async function () {
      const { vault, stranger } = await loadFixture(initializedFixture);
      await expect(vault.connect(stranger).claim())
        .to.be.revertedWithCustomError(vault, "NothingToClaim");
    });

    it("claimFor() отправляет средства на указанный кошелёк", async function () {
      const { vault, usdc, owner, artist } = await loadFixture(fundedFixture);
      const amount = ethers.parseUnits("500", 6);
      await vault.accrue([artist.address], [amount]);

      // owner вызывает claimFor от имени artist
      await vault.connect(owner).claimFor(artist.address);

      expect(await usdc.balanceOf(artist.address)).to.equal(amount);
      expect(await vault.claimable(artist.address)).to.equal(0);
    });

    it("claimFor() может вызвать кто угодно (non-custodial)", async function () {
      const { vault, usdc, stranger, artist } = await loadFixture(fundedFixture);
      const amount = ethers.parseUnits("500", 6);
      await vault.accrue([artist.address], [amount]);

      // stranger не владелец — но может триггернуть claim для artist
      await vault.connect(stranger).claimFor(artist.address);
      expect(await usdc.balanceOf(artist.address)).to.equal(amount);
    });

    it("claimFor() revert если нулевой адрес", async function () {
      const { vault } = await loadFixture(initializedFixture);
      await expect(vault.claimFor(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(vault, "InvalidAddress");
    });

    it("accrue revert если недостаточно баланса", async function () {
      const { vault, artist } = await loadFixture(fundedFixture);
      await expect(vault.accrue([artist.address], [ethers.parseUnits("9999", 6)]))
        .to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });
  });

  // ── Pause / EmergencyWithdraw ──────────────────────────────────────────

  describe("pause / emergencyWithdraw", function () {
    it("pause блокирует deposit", async function () {
      const { vault } = await loadFixture(initializedFixture);
      await vault.pause();
      await expect(vault.depositRevenue(1)).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });

    it("emergencyWithdraw возвращает средства owner", async function () {
      const { vault, usdc, owner, vaultAddress } = await loadFixture(fundedFixture);
      await vault.pause();
      const before = await usdc.balanceOf(owner.address);
      await vault.emergencyWithdraw(owner.address);
      const after = await usdc.balanceOf(owner.address);
      expect(after - before).to.equal(ethers.parseUnits("1000", 6));
    });
  });

  // ── getContributors / previewShare ────────────────────────────────────

  describe("view functions", function () {
    it("getContributors() возвращает правильный список", async function () {
      const { vault, wallets, percentages } = await loadFixture(initializedFixture);
      const list = await vault.getContributors();
      expect(list.length).to.equal(3);
      expect(list[0].wallet).to.equal(wallets[0]);
      expect(list[0].percentage).to.equal(percentages[0]);
    });

    it("previewShare() корректно для artist (50%)", async function () {
      const { vault, artist } = await loadFixture(fundedFixture);
      expect(await vault.previewShare(artist.address)).to.equal(ethers.parseUnits("500", 6));
    });
  });
});

// ── SplitVaultFactory ─────────────────────────────────────────────────────────

describe("SplitVaultFactory", function () {
  async function deployFactory() {
    const [deployer, projectOwner] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("SplitVaultFactory");
    const factory = await Factory.deploy();
    return { factory, deployer, projectOwner };
  }

  it("createVault() деплоит новый SplitVault с правильным owner", async function () {
    const { factory, projectOwner } = await loadFixture(deployFactory);
    const tx = await factory.createVault(projectOwner.address);
    const receipt = await tx.wait();

    // Парсим VaultCreated event
    const iface = (await ethers.getContractFactory("SplitVaultFactory")).interface;
    const event = receipt!.logs
      .map((log: any) => { try { return iface.parseLog(log); } catch { return null; } })
      .find((e: any) => e?.name === "VaultCreated");

    expect(event).to.not.be.null;
    const vaultAddress = event!.args.vault;

    const vault = await ethers.getContractAt("SplitVault", vaultAddress);
    expect(await vault.owner()).to.equal(projectOwner.address);
    expect(await vault.initialized()).to.equal(false);
  });

  it("createVault() emits VaultCreated", async function () {
    const { factory, projectOwner } = await loadFixture(deployFactory);
    await expect(factory.createVault(projectOwner.address))
      .to.emit(factory, "VaultCreated")
      .withArgs(projectOwner.address, ethers.isAddress, (ts: bigint) => ts > 0n);
  });

  it("createVault() revert при нулевом owner", async function () {
    const { factory } = await loadFixture(deployFactory);
    await expect(factory.createVault(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(
        await ethers.getContractAt("SplitVault", ethers.ZeroAddress).catch(() =>
          ethers.getContractFactory("SplitVault").then(f => f.deploy(ethers.ZeroAddress).catch(() => ({ interface: (ethers.getContractFactory("SplitVault") as any).interface })))
        ) as any,
        "InvalidAddress"
      );
  });

  it("каждый createVault() деплоит отдельный контракт", async function () {
    const { factory, deployer, projectOwner } = await loadFixture(deployFactory);
    const tx1 = await factory.createVault(deployer.address);
    const tx2 = await factory.createVault(projectOwner.address);
    const r1 = await tx1.wait();
    const r2 = await tx2.wait();

    const iface = (await ethers.getContractFactory("SplitVaultFactory")).interface;
    const getVault = (r: any) => r.logs
      .map((l: any) => { try { return iface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "VaultCreated")?.args.vault;

    expect(getVault(r1)).to.not.equal(getVault(r2));
  });
});
