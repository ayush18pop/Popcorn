// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PauseTarget} from "src/blocks/actions/PauseTarget.sol";
import {VaultLayout} from "src/proofs/VaultLayout.sol";
import {TokenOut} from "src/blocks/TokenOut.sol";

/// @title Demo Vault (a target: demo, not a block)
/// @notice The protocol the Proof-of-Exploit Bounty protects: an ERC-4626-style vault with a pause switch (Pause The Target)
///         and nothing else. No trigger, no reward, no proof: those are blocks the build adds. Users call deposit /
///         withdraw / redeem on the build's address with ordinary transactions (Core forwards them here), and its state
///         lives in the build's own storage (VaultLayout).
///
///         Math: exactly docs/guarded-vault.md §3, INCLUDING THE PLANTED BUG (withdraw divides before multiplying:
///         rate = S / T, shares = a * rate). The exploit circuit proves facts about these formulas, and the build's tests
///         replay zk/fixtures/valid.json against this vault.
///
///         Setup: the storage starts empty; `initialize()` (once, by OWNER) copies asset, owner and the share-price floor
///         from the logic's immutables. `harvest` (owner) adds yield and works while paused: it is how the owner tops the
///         vault back up before reopening it.
abstract contract DemoVault is PauseTarget {
    address public immutable OWNER;
    address public immutable ASSET;
    uint88 public immutable MIN_ASSETS_PER_SHARE;

    uint256 internal constant MAX120 = type(uint120).max;

    event Initialized(address asset, address owner, uint88 minAssetsPerShare);
    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event Withdraw(address indexed user, uint256 assets, uint256 shares);
    event Redeem(address indexed user, uint256 assets, uint256 shares);
    event Harvest(uint256 assets);

    error NotOwner();
    error AlreadyInitialized();
    error NotInitialized();
    error ZeroAmount();
    error ExceedsMaxWithdraw(uint256 assets, uint256 max);
    error InsufficientShares(uint256 shares, uint256 balance);
    error Overflow();
    error TransferFailed();

    constructor(address owner_, address asset_, uint88 minAssetsPerShare_) {
        OWNER = owner_;
        ASSET = asset_;
        MIN_ASSETS_PER_SHARE = minAssetsPerShare_;
    }

    function initialize() external forwarded {
        VaultLayout.VaultState storage v = VaultLayout.state();
        if (msg.sender != OWNER) revert NotOwner();
        if (v.asset != address(0)) revert AlreadyInitialized();
        v.asset = ASSET;
        v.owner = OWNER;
        v.minAssetsPerShare = MIN_ASSETS_PER_SHARE;
        emit Initialized(ASSET, OWNER, MIN_ASSETS_PER_SHARE);
    }

    /// @notice shares = S == 0 ? a : a * S / T (rounds down).
    function deposit(uint256 a) external forwarded returns (uint256 shares) {
        VaultLayout.VaultState storage v = _live();
        if (a == 0) revert ZeroAmount();
        uint256 t = v.totalAssets;
        uint256 s = v.totalSupply;
        shares = s == 0 ? a : a * s / t;
        _setTS(v, t + a, s + shares);
        v.balanceOf[msg.sender] += shares;
        _pull(v.asset, msg.sender, a);
        emit Deposit(msg.sender, a, shares);
    }

    /// @notice a = shares * T / S (rounds down).
    function redeem(uint256 shares) external forwarded returns (uint256 a) {
        VaultLayout.VaultState storage v = _live();
        uint256 bal = v.balanceOf[msg.sender];
        if (shares > bal) revert InsufficientShares(shares, bal);
        uint256 t = v.totalAssets;
        uint256 s = v.totalSupply;
        a = shares * t / s;
        _setTS(v, t - a, s - shares);
        v.balanceOf[msg.sender] = bal - shares;
        _push(v.asset, msg.sender, a);
        emit Redeem(msg.sender, a, shares);
    }

    /// @notice WITH THE PLANTED BUG: rate = S / T (truncates), shares = a * rate.
    function withdraw(uint256 a) external forwarded returns (uint256 shares) {
        VaultLayout.VaultState storage v = _live();
        uint256 t = v.totalAssets;
        uint256 s = v.totalSupply;
        uint256 bal = v.balanceOf[msg.sender];
        uint256 cap = s == 0 ? 0 : bal * t / s;
        if (a > cap) revert ExceedsMaxWithdraw(a, cap);
        uint256 rate = s / t; // BUG: division before multiplication (the correct burn is ceil(a * S / T))
        shares = a * rate;
        if (shares > bal) revert InsufficientShares(shares, bal);
        _setTS(v, t - a, s - shares);
        v.balanceOf[msg.sender] = bal - shares;
        _push(v.asset, msg.sender, a);
        emit Withdraw(msg.sender, a, shares);
    }

    /// @notice Owner adds yield: T += y. Allowed while paused (topping the vault up is how it becomes safe to reopen).
    function harvest(uint256 y) external forwarded {
        VaultLayout.VaultState storage v = VaultLayout.state();
        if (v.asset == address(0)) revert NotInitialized();
        if (msg.sender != v.owner) revert NotOwner();
        _setTS(v, v.totalAssets + y, v.totalSupply);
        _pull(v.asset, msg.sender, y);
        emit Harvest(y);
    }

    // ------------------------------------------------------------------ views (forwarded)

    function totalAssets() external view returns (uint256) {
        return VaultLayout.state().totalAssets;
    }

    function totalSupply() external view returns (uint256) {
        return VaultLayout.state().totalSupply;
    }

    function balanceOf(address a) external view returns (uint256) {
        return VaultLayout.state().balanceOf[a];
    }

    function minAssetsPerShare() external view returns (uint88) {
        return VaultLayout.state().minAssetsPerShare;
    }

    function asset() external view returns (address) {
        return VaultLayout.state().asset;
    }

    function owner() external view returns (address) {
        return VaultLayout.state().owner;
    }

    /// @notice maxWithdraw(o) = balanceOf[o] * T / S.
    function maxWithdraw(address o) public view returns (uint256) {
        VaultLayout.VaultState storage v = VaultLayout.state();
        uint256 s = v.totalSupply;
        return s == 0 ? 0 : v.balanceOf[o] * v.totalAssets / s;
    }

    // ------------------------------------------------------------------ for the build's checks (two own-storage words)

    /// @notice (totalAssets, totalSupply, minAssetsPerShare) from the two raw words, for a check that runs in VERIFY.
    function _vaultNumbers() internal view returns (uint256 t, uint256 s, uint256 m) {
        uint256 w0 = _sload(VaultLayout.BASE);
        t = w0 & MAX120;
        s = (w0 >> 120) & MAX120;
        m = _sload(bytes32(uint256(VaultLayout.BASE) + 1)) & type(uint88).max;
    }

    function _setMinAssetsPerShare(uint88 m) internal {
        VaultLayout.state().minAssetsPerShare = m;
    }

    // ------------------------------------------------------------------ internals

    function _live() internal view whenNotPaused returns (VaultLayout.VaultState storage v) {
        v = VaultLayout.state();
        if (v.asset == address(0)) revert NotInitialized();
    }

    function _setTS(VaultLayout.VaultState storage v, uint256 t, uint256 s) internal {
        if (t > MAX120 || s > MAX120) revert Overflow();
        v.totalAssets = uint120(t);
        v.totalSupply = uint120(s);
    }

    function _pull(address token, address from, uint256 a) internal {
        if (!TokenOut.pull(token, from, a)) revert TransferFailed();
    }

    function _push(address token, address to, uint256 a) internal {
        if (!TokenOut.send(token, to, a, gasleft())) revert TransferFailed();
    }
}
