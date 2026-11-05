// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {RulePays} from "src/payers/RulePays.sol";
import {IVerifier} from "src/interfaces/IVerifier.sol";
import {VaultLayout} from "src/proofs/VaultLayout.sol";
import {ExploitInputs} from "src/proofs/ExploitInputs.sol";

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title GuardedVault
/// @notice An ERC-4626-style vault that IS a Popcorn rule contract: users call deposit / withdraw / redeem on the
///         rule contract address with ordinary txs (Core forwards them here), the vault state lives in the rule contract's own storage
///         (ERC-7201 `VaultLayout`, docs/guarded-vault.md §4), and the rule contract triggers itself when the invariant breaks.
///
///         Math: exactly docs/guarded-vault.md §3, INCLUDING THE PLANTED BUG (withdraw divides before multiplying:
///         rate = S / T, shares = a * rate). The proof-of-exploit circuit proves facts about these formulas; the conformance
///         test (contracts/test/GuardedVault.t.sol) replays zk/fixtures/valid.json against this contract.
///
///         Triggers (anyone can send them; the rule contract pays):
///           pause   popArgs = abi.encode(address reporter)                  (32 bytes)
///                   key       = keccak256(abi.encode("pause", address(this), pauseEpoch))
///                   condition = !paused && T * 1e18 < S * M                 (two own-storage words, no division)
///                   action    = paused = true, pauseEpoch += 1, pay min(pauseReward, rewardPool) of `asset` to reporter
///           bounty  popArgs = abi.encode(address recipient, uint64 claimId)  (64 bytes), verifyData = Groth16 proof
///                   key       = ExploitInputs.bountyNonceKey() = keccak256(abi.encode("bounty", address(this), pauseEpoch))
///                   condition = bountyVerifier != 0 && verifier.verify(proof, ExploitInputs.fromStorage(recipient, claimId))
///                               (fromStorage reverts while paused)
///                   action    = paused = true, pauseEpoch += 1, pay min(bountyReward, rewardPool) to recipient
///         One key per epoch per kind, and both actions pause and bump the epoch while both conditions require !paused, so
///         at most one paid trigger per pause epoch in total (a stale key is consumed; a fresh key's condition is false).
///         Rewards come from a token pool funded by anyone (`fundRewards`), separate from T. The pause reward is
///         copyable by a mempool observer: bound it small. The bounty pays only the proof's recipient.
///
///         Profiles (one logic source, two rule contracts): pause-only = no verifier, conditionGas ~10k, popArgs 32,
///         verifyData 0 (public mempool). Bounty = verifier set, conditionGas 220k, popArgs 64, verifyData 256, staked.
///
///         Owner recovery: `harvest` works while paused (top up T), and `unpause` requires the invariant to hold again.
///
///         Setup: the rule contract's storage starts empty; `initialize()` (callable once, by the immutable OWNER) copies asset,
///         owner and minAssetsPerShare from this logic's immutables into the rule contract's storage.
contract GuardedVault is RuleContract, RulePays {
    // ------------------------------------------------------------------ configuration (logic immutables)
    address public immutable OWNER;
    address public immutable ASSET;
    uint88 public immutable MIN_ASSETS_PER_SHARE;
    uint256 public immutable PAUSE_REWARD;
    uint256 public immutable BOUNTY_REWARD;
    IVerifier public immutable BOUNTY_VERIFIER; // 0 = bounty triggers disabled (pause-only profile)
    uint256 public immutable STAKE_AMOUNT; // 0 = no stake trigger (pause-only profile)
    uint256 public immutable WITHDRAW_NOTICE; // seconds between ownerStartWithdraw and ownerFinishWithdraw

    uint256 internal constant WAD = 1e18;
    uint256 internal constant MAX120 = type(uint120).max;

    /// @dev ERC-7201 "popcorn.vault.selfdefending": slot 0 = rewardPool (uint256).
    ///      keccak256(abi.encode(uint256(keccak256("popcorn.vault.selfdefending")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant EXTRA = 0x114dd8b93787ae99750d76487da7d566507990b8ccae0310c058895ae68c3300;

    event Initialized(address asset, address owner, uint88 minAssetsPerShare);
    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event Withdraw(address indexed user, uint256 assets, uint256 shares);
    event Redeem(address indexed user, uint256 assets, uint256 shares);
    event Harvest(uint256 assets);
    event RewardsFunded(address indexed from, uint256 amount);
    event VaultPaused(uint64 indexed epoch, address indexed reporter, uint256 reward, bool bounty, bool rewardPaid);
    event VaultUnpaused(uint64 epoch);
    event ThresholdChanged(uint88 minAssetsPerShare);

    error NotOwner();
    error AlreadyInitialized();
    error NotInitialized();
    error Paused();
    error NotPaused();
    error ZeroAmount();
    error ExceedsMaxWithdraw(uint256 assets, uint256 max);
    error InsufficientShares(uint256 shares, uint256 balance);
    error Overflow();
    error TransferFailed();
    error BadPopArgs(uint256 length);
    error InvariantBroken();

    constructor(
        address owner_,
        address asset_,
        uint88 minAssetsPerShare_,
        uint256 pauseReward_,
        uint256 bountyReward_,
        IVerifier bountyVerifier_,
        uint256 stakeAmount_,
        uint256 withdrawNotice_
    ) {
        OWNER = owner_;
        ASSET = asset_;
        MIN_ASSETS_PER_SHARE = minAssetsPerShare_;
        PAUSE_REWARD = pauseReward_;
        BOUNTY_REWARD = bountyReward_;
        BOUNTY_VERIFIER = bountyVerifier_;
        STAKE_AMOUNT = stakeAmount_;
        WITHDRAW_NOTICE = withdrawNotice_;
    }

    // ================================================================== forwarded user API (ordinary txs)

    /// @notice One-time setup by OWNER: writes asset, owner and minAssetsPerShare into the rule contract's VaultLayout.
    function initialize() external forwarded {
        VaultLayout.VaultState storage v = VaultLayout.state();
        if (msg.sender != OWNER) revert NotOwner();
        if (v.asset != address(0)) revert AlreadyInitialized();
        v.asset = ASSET;
        v.owner = OWNER;
        v.minAssetsPerShare = MIN_ASSETS_PER_SHARE;
        emit Initialized(ASSET, OWNER, MIN_ASSETS_PER_SHARE);
    }

    /// @notice guarded-vault.md §3 deposit: shares = S == 0 ? a : a * S / T (rounds down).
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

    /// @notice guarded-vault.md §3 redeem: a = shares * T / S (rounds down).
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

    /// @notice guarded-vault.md §3 withdraw, WITH THE PLANTED BUG: rate = S / T (truncates), shares = a * rate.
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

    /// @notice guarded-vault.md §3 harvest (owner): T += y, pulls y of asset. Allowed while paused: it is how the owner tops the
    ///         vault back up to the invariant before `unpause` (without it a paused, broken vault could
    ///         only be reopened broken, and every unpause paid another reporter reward).
    function harvest(uint256 y) external forwarded {
        VaultLayout.VaultState storage v = VaultLayout.state();
        if (v.asset == address(0)) revert NotInitialized();
        if (msg.sender != v.owner) revert NotOwner();
        _setTS(v, v.totalAssets + y, v.totalSupply);
        _pull(v.asset, msg.sender, y);
        emit Harvest(y);
    }

    /// @notice Adds `amount` of asset to the reward pool (not part of T). Anyone may fund it.
    function fundRewards(uint256 amount) external forwarded {
        VaultLayout.VaultState storage v = VaultLayout.state();
        if (v.asset == address(0)) revert NotInitialized();
        _setRewardPool(rewardPool() + amount);
        _pull(v.asset, msg.sender, amount);
        emit RewardsFunded(msg.sender, amount);
    }

    /// @notice Owner reopens the vault (a new pause epoch is already open). OWNER-CALL ONLY: it runs inside Core's
    ///         hybrid owner frame, so it needs the owner's ECDSA and WOTS signatures; `OWNER` (the plain address) can no longer
    ///         call it. Requires the invariant to hold (T * 1e18 >= S * M): top the vault up with `harvest` first. Reopening
    ///         a broken vault would let the attacker keep withdrawing and pay a reward on every re-trigger.
    function unpause() external onlyOwnerCall {
        VaultLayout.VaultState storage v = VaultLayout.state();
        if (!v.paused) revert NotPaused();
        if (uint256(v.totalAssets) * WAD < uint256(v.totalSupply) * v.minAssetsPerShare) revert InvariantBroken();
        v.paused = false;
        emit VaultUnpaused(v.pauseEpoch);
    }

    /// @notice Owner changes the invariant's minimum assets per share (the pause threshold). Owner-call only. The trigger's
    ///         condition reads it, so it takes effect for the next pause check.
    function setThreshold(uint88 m) external onlyOwnerCall {
        VaultLayout.VaultState storage v = VaultLayout.state();
        v.minAssetsPerShare = m;
        emit ThresholdChanged(m);
    }

    function _withdrawNotice() internal view override returns (uint256) {
        return WITHDRAW_NOTICE;
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

    function paused() external view returns (bool) {
        return VaultLayout.state().paused;
    }

    function pauseEpoch() external view returns (uint64) {
        return VaultLayout.state().pauseEpoch;
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

    /// @notice guarded-vault.md §3 maxWithdraw(o) = balanceOf[o] * T / S.
    function maxWithdraw(address o) public view returns (uint256) {
        VaultLayout.VaultState storage v = VaultLayout.state();
        uint256 s = v.totalSupply;
        return s == 0 ? 0 : v.balanceOf[o] * v.totalAssets / s;
    }

    function rewardPool() public view returns (uint256 p) {
        bytes32 slot = EXTRA;
        assembly ("memory-safe") {
            p := sload(slot)
        }
    }

    /// @notice The pause trigger's condition (what a watcher polls): !paused && T * 1e18 < S * M.
    function isBroken() external view returns (bool) {
        return _pauseCondition();
    }

    /// @notice The pause trigger's nonce key for the current epoch (what a watcher puts in the frame tx).
    function pauseNonceKey() external view returns (uint256) {
        return _pauseKey();
    }

    /// @notice The bounty trigger's nonce key for the current epoch.
    function bountyNonceKey() external view returns (uint256) {
        return uint256(ExploitInputs.bountyNonceKey());
    }

    /// @notice The proof's public inputs as the bounty condition builds them (reverts VaultPaused while paused).
    function exploitInputs(address recipient, uint256 claimId) external view returns (uint256[] memory) {
        return ExploitInputs.fromStorage(recipient, claimId);
    }

    // ================================================================== trigger hooks (Core VERIFY / SENDER)

    function nonceKey(bytes calldata popArgs) internal view override returns (uint256) {
        if (popArgs.length == 32) return _pauseKey();
        if (popArgs.length == 64) return uint256(ExploitInputs.bountyNonceKey());
        revert BadPopArgs(popArgs.length);
    }

    function condition(bytes calldata popArgs, bytes calldata verifyData) internal view override returns (bool) {
        if (popArgs.length == 32) {
            // reporter must be a clean address word, and not the vault itself (its reward would stay in the rule contract,
            // unaccounted)
            if (_address(popArgs, 0) == address(this)) return false;
            return _pauseCondition();
        }
        if (popArgs.length == 64) {
            if (address(BOUNTY_VERIFIER) == address(0)) return false;
            uint256[] memory inputs = ExploitInputs.fromStorage(_address(popArgs, 0), _word(popArgs, 1));
            (bool ok, bytes memory ret) =
                address(BOUNTY_VERIFIER).staticcall(abi.encodeCall(IVerifier.verify, (verifyData, inputs)));
            return ok && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
        }
        return false;
    }

    /// @dev Never reverts after the state change: pausing must stick even if the reward transfer fails.
    function action(bytes calldata popArgs, address) internal override {
        bool bounty = popArgs.length == 64;
        address to = _address(popArgs, 0);
        VaultLayout.VaultState storage v = VaultLayout.state();
        uint64 epoch = v.pauseEpoch;
        v.paused = true;
        v.pauseEpoch = epoch + 1;
        uint256 pool = rewardPool();
        uint256 want = bounty ? BOUNTY_REWARD : PAUSE_REWARD;
        uint256 reward = want < pool ? want : pool;
        bool paid;
        if (reward > 0 && to != address(0) && to != address(this)) {
            _setRewardPool(pool - reward);
            paid = _tryPush(v.asset, to, reward);
            if (!paid) _setRewardPool(pool);
        }
        emit VaultPaused(epoch, to, paid ? reward : 0, bounty, paid);
    }

    function _stakeConfig() internal view override returns (address, uint256, uint32) {
        return (DEVNET_STAKING_REGISTRY, STAKE_AMOUNT, 86_400);
    }

    // ================================================================== internals

    function _pauseCondition() internal view returns (bool) {
        uint256 w0 = _sload(VaultLayout.BASE);
        if (w0 & ExploitInputs.PAUSED_BIT != 0) return false;
        uint256 t = w0 & MAX120;
        uint256 s = (w0 >> 120) & MAX120;
        uint256 m = _sload(bytes32(uint256(VaultLayout.BASE) + 1)) & ExploitInputs.MASK88;
        return t * WAD < s * m;
    }

    function _pauseKey() internal view returns (uint256) {
        uint64 epoch = uint64(_sload(bytes32(uint256(VaultLayout.BASE) + 1)) >> 88);
        return uint256(keccak256(abi.encode("pause", address(this), epoch)));
    }

    function _live() internal view returns (VaultLayout.VaultState storage v) {
        v = VaultLayout.state();
        if (v.asset == address(0)) revert NotInitialized();
        if (v.paused) revert Paused();
    }

    function _setTS(VaultLayout.VaultState storage v, uint256 t, uint256 s) internal {
        if (t > MAX120 || s > MAX120) revert Overflow();
        v.totalAssets = uint120(t);
        v.totalSupply = uint120(s);
    }

    function _setRewardPool(uint256 p) internal {
        bytes32 slot = EXTRA;
        assembly ("memory-safe") {
            sstore(slot, p)
        }
    }

    function _pull(address token, address from, uint256 a) internal {
        if (!_callOk(token, abi.encodeCall(IERC20Min.transferFrom, (from, address(this), a)))) revert TransferFailed();
    }

    function _push(address token, address to, uint256 a) internal {
        if (!_tryPush(token, to, a)) revert TransferFailed();
    }

    function _tryPush(address token, address to, uint256 a) internal returns (bool) {
        return _callOk(token, abi.encodeCall(IERC20Min.transfer, (to, a)));
    }

    function _callOk(address token, bytes memory data) internal returns (bool) {
        (bool ok, bytes memory ret) = token.call(data);
        return ok && token.code.length > 0 && (ret.length == 0 || (ret.length == 32 && abi.decode(ret, (uint256)) == 1));
    }
}
