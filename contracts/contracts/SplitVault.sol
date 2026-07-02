// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SplitVault
 * @notice Автоматическое распределение USDC между участниками музыкального проекта
 * @dev Deployed on Arc Testnet (Chain ID: 5042002). Gas token = USDC.
 */
contract SplitVault is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────
    // STRUCTS & STATE
    // ─────────────────────────────────────────────

    struct Contributor {
        address wallet;
        uint256 percentage; // basis points (100 = 1%), сумма всех = 10000
        uint256 totalPaid;  // total USDC paid out (6 decimals)
        string  role;       // "artist", "producer", "label", etc.
        bool    active;
    }

    struct ProjectInfo {
        string  name;
        address usdcToken;
        uint256 totalDeposited;
        uint256 totalDistributed;
        uint256 pendingBalance;
        bool    initialized;
        bool    paused;
        uint256 contributorCount;
    }

    // ─────────────────────────────────────────────

    IERC20 public usdcToken;

    string  public projectName;
    bool    public initialized;

    uint256 public totalDeposited;
    uint256 public totalDistributed;

    Contributor[] public contributors;

    // wallet → contributor index+1 (0 = not found)
    mapping(address => uint256) private contributorIndex;

    // pull-claim: accrued-but-not-yet-withdrawn balance per wallet
    mapping(address => uint256) public claimable;

    // ─────────────────────────────────────────────
    // EVENTS
    // ─────────────────────────────────────────────

    event Initialized(string projectName, address usdcToken, address owner);
    event ContributorAdded(address indexed wallet, uint256 percentage, string role);
    event ContributorUpdated(address indexed wallet, uint256 newPercentage);
    event ContributorRemoved(address indexed wallet);
    event RevenueDeposited(address indexed from, uint256 amount, uint256 timestamp);
    event RevenueDistributed(uint256 totalAmount, uint256 contributorCount, uint256 timestamp);
    event PaymentSent(address indexed wallet, uint256 amount, string role);
    event EmergencyWithdraw(address indexed to, uint256 amount);
    event PayEach(address indexed recipient, uint256 amount);
    event Accrued(address indexed recipient, uint256 amount);
    event Claimed(address indexed wallet, uint256 amount);

    // ─────────────────────────────────────────────
    // ERRORS
    // ─────────────────────────────────────────────

    error AlreadyInitialized();
    error NotInitialized();
    error InvalidAddress();
    error InvalidPercentage();
    error PercentageSumExceeds10000();
    error ContributorNotFound();
    error ContributorAlreadyExists();
    error NoContributors();
    error NothingToDistribute();
    error InsufficientBalance();
    error ZeroAmount();
    error TransferFailed();
    error LengthMismatch();
    error NothingToClaim();

    // ─────────────────────────────────────────────
    // MODIFIERS
    // ─────────────────────────────────────────────

    modifier onlyInitialized() {
        if (!initialized) revert NotInitialized();
        _;
    }

    // ─────────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────────

    /// @param _owner  адрес владельца (лейбл / создатель проекта)
    constructor(address _owner) Ownable(_owner) {}

    // ─────────────────────────────────────────────
    // INITIALIZATION
    // ─────────────────────────────────────────────

    /**
     * @notice Инициализирует vault: задаёт имя проекта, адрес USDC и список участников.
     * @param _projectName  Название проекта
     * @param _usdcToken    Адрес USDC контракта на Arc Testnet
     * @param _wallets      Адреса участников
     * @param _percentages  Basis points для каждого участника (сумма = 10000)
     * @param _roles        Роли участников
     */
    function initialize(
        string calldata _projectName,
        address _usdcToken,
        address[] calldata _wallets,
        uint256[] calldata _percentages,
        string[] calldata _roles
    ) external onlyOwner {
        if (initialized) revert AlreadyInitialized();
        if (_usdcToken == address(0)) revert InvalidAddress();
        if (_wallets.length == 0) revert NoContributors();
        if (
            _wallets.length != _percentages.length ||
            _wallets.length != _roles.length
        ) revert InvalidPercentage();

        // Проверяем сумму basis points
        uint256 total;
        for (uint256 i = 0; i < _percentages.length; i++) {
            if (_wallets[i] == address(0)) revert InvalidAddress();
            if (_percentages[i] == 0 || _percentages[i] > 10000) revert InvalidPercentage();
            total += _percentages[i];
        }
        if (total != 10000) revert PercentageSumExceeds10000();

        usdcToken   = IERC20(_usdcToken);
        projectName = _projectName;
        initialized = true;

        for (uint256 i = 0; i < _wallets.length; i++) {
            _addContributor(_wallets[i], _percentages[i], _roles[i]);
        }

        emit Initialized(_projectName, _usdcToken, owner());
    }

    // ─────────────────────────────────────────────
    // CONTRIBUTOR MANAGEMENT
    // ─────────────────────────────────────────────

    /**
     * @notice Добавить участника. Нужно вручную поддерживать сумму = 10000.
     * @dev    Вызывать только через replaceContributors для атомарности.
     */
    function _addContributor(
        address _wallet,
        uint256 _percentage,
        string memory _role
    ) internal {
        if (contributorIndex[_wallet] != 0) revert ContributorAlreadyExists();

        contributors.push(Contributor({
            wallet:    _wallet,
            percentage: _percentage,
            totalPaid: 0,
            role:      _role,
            active:    true
        }));

        contributorIndex[_wallet] = contributors.length; // 1-based
        emit ContributorAdded(_wallet, _percentage, _role);
    }

    /**
     * @notice Полная замена списка участников (атомарная операция).
     *         Pending баланс НЕ трогается — сначала вызови distribute().
     */
    function replaceContributors(
        address[] calldata _wallets,
        uint256[] calldata _percentages,
        string[] calldata _roles
    ) external onlyOwner onlyInitialized whenNotPaused {
        if (_wallets.length == 0) revert NoContributors();
        if (
            _wallets.length != _percentages.length ||
            _wallets.length != _roles.length
        ) revert InvalidPercentage();

        uint256 total;
        for (uint256 i = 0; i < _percentages.length; i++) {
            if (_wallets[i] == address(0)) revert InvalidAddress();
            if (_percentages[i] == 0 || _percentages[i] > 10000) revert InvalidPercentage();
            total += _percentages[i];
        }
        if (total != 10000) revert PercentageSumExceeds10000();

        // Очищаем старый индекс
        for (uint256 i = 0; i < contributors.length; i++) {
            delete contributorIndex[contributors[i].wallet];
        }
        delete contributors;

        for (uint256 i = 0; i < _wallets.length; i++) {
            _addContributor(_wallets[i], _percentages[i], _roles[i]);
        }
    }

    // ─────────────────────────────────────────────
    // CORE: DEPOSIT & DISTRIBUTE
    // ─────────────────────────────────────────────

    /**
     * @notice Депозит USDC в vault.
     *         Вызывается лейблом (Circle Dev-Controlled Wallet).
     * @param _amount  Сумма в USDC (6 decimals)
     */
    function depositRevenue(uint256 _amount)
        external
        onlyInitialized
        whenNotPaused
        nonReentrant
    {
        if (_amount == 0) revert ZeroAmount();

        usdcToken.safeTransferFrom(msg.sender, address(this), _amount);
        totalDeposited += _amount;

        emit RevenueDeposited(msg.sender, _amount, block.timestamp);
    }

    /**
     * @notice Распределяет весь pending баланс между участниками.
     *         Может вызывать owner или любой участник.
     */
    function distribute()
        external
        onlyInitialized
        whenNotPaused
        nonReentrant
    {
        uint256 pending = usdcToken.balanceOf(address(this));
        if (pending == 0) revert NothingToDistribute();
        _distribute(pending);
    }

    /**
     * @notice Распределяет указанную сумму (<= pending баланса) между участниками,
     *         остаток остаётся в vault для последующего distribute().
     *         Может вызывать owner или любой участник.
     * @param _amount  Сумма USDC (6 decimals) для распределения
     */
    function distributePartial(uint256 _amount)
        external
        onlyInitialized
        whenNotPaused
        nonReentrant
    {
        if (_amount == 0) revert ZeroAmount();
        uint256 pending = usdcToken.balanceOf(address(this));
        if (_amount > pending) revert InsufficientBalance();
        _distribute(_amount);
    }

    function _distribute(uint256 _amount) internal {
        if (contributors.length == 0) revert NoContributors();

        uint256 distributed;
        uint256 len = contributors.length;

        for (uint256 i = 0; i < len; i++) {
            Contributor storage c = contributors[i];
            if (!c.active) continue;

            uint256 share = (_amount * c.percentage) / 10000;
            if (share == 0) continue;

            c.totalPaid += share;
            distributed += share;

            usdcToken.safeTransfer(c.wallet, share);
            emit PaymentSent(c.wallet, share, c.role);
        }

        // Dust (остаток от деления basis points в пределах _amount) → owner
        uint256 dust = _amount - distributed;
        if (dust > 0) {
            usdcToken.safeTransfer(owner(), dust);
            distributed += dust;
        }

        totalDistributed += distributed;

        emit RevenueDistributed(distributed, len, block.timestamp);
    }

    // ─────────────────────────────────────────────
    // FIXED-AMOUNT & PULL-CLAIM
    // ─────────────────────────────────────────────

    /**
     * @notice Push exact USDC amounts to each recipient in one call.
     *         Used by the backend keeper for fixed-amount and %-computed distributions.
     *         Recipients need not be registered contributors — useful when a share is
     *         computed off-chain (computeShares) and paid in one shot.
     */
    function payEach(
        address[] calldata _recipients,
        uint256[] calldata _amounts
    ) external onlyOwner onlyInitialized whenNotPaused nonReentrant {
        if (_recipients.length == 0 || _recipients.length != _amounts.length) revert LengthMismatch();

        uint256 total;
        for (uint256 i = 0; i < _amounts.length; i++) total += _amounts[i];
        if (usdcToken.balanceOf(address(this)) < total) revert InsufficientBalance();

        for (uint256 i = 0; i < _recipients.length; i++) {
            if (_recipients[i] == address(0)) revert InvalidAddress();
            if (_amounts[i] == 0) continue;
            usdcToken.safeTransfer(_recipients[i], _amounts[i]);
            totalDistributed += _amounts[i];
            emit PayEach(_recipients[i], _amounts[i]);
        }
    }

    /**
     * @notice Accumulate claimable balances without pushing (pull-claim model).
     *         The keeper/owner calls this; each recipient later calls claim().
     *         Funds remain in the vault until claimed.
     */
    function accrue(
        address[] calldata _recipients,
        uint256[] calldata _amounts
    ) external onlyOwner onlyInitialized whenNotPaused nonReentrant {
        if (_recipients.length == 0 || _recipients.length != _amounts.length) revert LengthMismatch();

        uint256 total;
        for (uint256 i = 0; i < _amounts.length; i++) total += _amounts[i];
        if (usdcToken.balanceOf(address(this)) < total) revert InsufficientBalance();

        for (uint256 i = 0; i < _recipients.length; i++) {
            if (_recipients[i] == address(0)) revert InvalidAddress();
            if (_amounts[i] == 0) continue;
            claimable[_recipients[i]] += _amounts[i];
            emit Accrued(_recipients[i], _amounts[i]);
        }
    }

    /**
     * @notice A contributor pulls their entire claimable balance.
     *         Gas is paid by the caller (or a paymaster via ERC-4337).
     */
    function claim() external onlyInitialized whenNotPaused nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalDistributed += amount;
        usdcToken.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /**
     * @notice Anyone can trigger a claim on behalf of a wallet — funds always go to
     *         that wallet. Non-custodial: the destination cannot be changed.
     *         Lets the platform keeper settle claims without the participant signing.
     */
    function claimFor(address _wallet) external onlyInitialized whenNotPaused nonReentrant {
        if (_wallet == address(0)) revert InvalidAddress();
        uint256 amount = claimable[_wallet];
        if (amount == 0) revert NothingToClaim();
        claimable[_wallet] = 0;
        totalDistributed += amount;
        usdcToken.safeTransfer(_wallet, amount);
        emit Claimed(_wallet, amount);
    }

    // ─────────────────────────────────────────────
    // VIEW FUNCTIONS
    // ─────────────────────────────────────────────

    /// @notice Возвращает всю информацию о проекте
    function getProjectInfo() external view returns (ProjectInfo memory) {
        return ProjectInfo({
            name:             projectName,
            usdcToken:        address(usdcToken),
            totalDeposited:   totalDeposited,
            totalDistributed: totalDistributed,
            pendingBalance:   initialized ? usdcToken.balanceOf(address(this)) : 0,
            initialized:      initialized,
            paused:           paused(),
            contributorCount: contributors.length
        });
    }

    /// @notice Возвращает список всех участников
    function getContributors() external view returns (Contributor[] memory) {
        return contributors;
    }

    /// @notice Возвращает данные конкретного участника
    function getContributor(address _wallet)
        external
        view
        returns (Contributor memory)
    {
        uint256 idx = contributorIndex[_wallet];
        if (idx == 0) revert ContributorNotFound();
        return contributors[idx - 1];
    }

    /// @notice Возвращает pending баланс vault
    function pendingBalance() external view returns (uint256) {
        if (!initialized) return 0;
        return usdcToken.balanceOf(address(this));
    }

    /// @notice Сколько получит участник при следующем distribute()
    function previewShare(address _wallet) external view returns (uint256) {
        uint256 idx = contributorIndex[_wallet];
        if (idx == 0) return 0;

        uint256 pending = usdcToken.balanceOf(address(this));
        if (pending == 0) return 0;

        return (pending * contributors[idx - 1].percentage) / 10000;
    }

    // ─────────────────────────────────────────────
    // ADMIN
    // ─────────────────────────────────────────────

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /**
     * @notice Экстренный вывод средств (только когда paused).
     */
    function emergencyWithdraw(address _to)
        external
        onlyOwner
        whenPaused
        nonReentrant
    {
        if (_to == address(0)) revert InvalidAddress();
        uint256 balance = usdcToken.balanceOf(address(this));
        if (balance == 0) revert NothingToDistribute();

        usdcToken.safeTransfer(_to, balance);
        emit EmergencyWithdraw(_to, balance);
    }
}
