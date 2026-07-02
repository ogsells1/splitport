// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SplitVault.sol";

/**
 * @title SplitVaultFactory
 * @notice Deploys a new SplitVault for each project. The platform pays deploy gas;
 *         the vault owner is set to `_owner` so the platform holds no fund keys.
 */
contract SplitVaultFactory {
    event VaultCreated(
        address indexed owner,
        address indexed vault,
        uint256 timestamp
    );

    /**
     * @notice Deploy a new SplitVault owned by `_owner`.
     * @param _owner  The project owner's wallet (Privy or EOA). Becomes vault owner.
     * @return vault  Address of the newly deployed SplitVault.
     */
    function createVault(address _owner) external returns (address vault) {
        if (_owner == address(0)) revert SplitVault.InvalidAddress();
        SplitVault v = new SplitVault(_owner);
        vault = address(v);
        emit VaultCreated(_owner, vault, block.timestamp);
    }
}
