// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The demo vault's storage (docs/guarded-vault.md §4), ERC-7201 namespaced so it cannot collide with
/// anything Core or RuleContract keep. GuardedVault and ExploitBounty both use it,
/// and ExploitInputs.fromStorage reads slots 0 and 1 of it raw.
///
///   slot base+0: totalAssets uint120 [bits 0..119] | totalSupply uint120 [120..239] | paused bool [240..247]
///   slot base+1: minAssetsPerShare uint88 [0..87] | pauseEpoch uint64 [88..151]
///   slot base+2: asset address
///   slot base+3: owner address
///   slot base+4: balanceOf mapping (balance of a = keccak256(abi.encode(a, base+4)))
library VaultLayout {
    /// @custom:storage-location erc7201:popcorn.vault.demo
    struct VaultState {
        uint120 totalAssets;
        uint120 totalSupply;
        bool paused;
        uint88 minAssetsPerShare;
        uint64 pauseEpoch;
        address asset;
        address owner;
        mapping(address => uint256) balanceOf;
    }

    bytes32 internal constant BASE = 0xe18b2d7ee7ce8700b82e0064e8a5a42e72025ee9bea0e34c50fbf75a6f8fbb00;

    function state() internal pure returns (VaultState storage s) {
        assembly ("memory-safe") {
            s.slot := BASE
        }
    }
}
