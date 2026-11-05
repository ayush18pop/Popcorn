// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleOwner} from "src/rules/RuleOwner.sol";

/// @notice ERC-8421 staking registry (devnet: NaiveStakingRegistry, core/SPEC.md §11). Stake is keyed by msg.sender.
interface IStakingRegistry {
    function addStake(uint32 unstakeDelaySec) external payable;
    function unlockStake() external;
    function withdrawStake(address payable to) external;
    function getDepositInfo(address account) external view returns (uint256 stake, uint32 unstakeDelaySec, uint64 withdrawTime);
}

/// @title RuleStake (built into RuleContract)
/// @notice The rule contract must stake itself: the registry keys stake by msg.sender, and Core accepts no call but its own
///         triggers. So staking is a trigger: popArgs == STAKE_POP_ARGS (exactly these 32 bytes) runs
///
///           nonceKey  = STAKE_NONCE_KEY_BASE | (attempts + skipped)   (not a keccak output: no popArgs hash can equal it)
///           condition = stake enabled (_stakeConfig amount > 0) && registry has code && not staked
///                       && attempts < MAX_STAKE_ATTEMPTS                       (own storage + EXTCODESIZE only)
///           action    = record the attempt FIRST, then registry.addStake{value: amount}(delay); it counts as staked
///                       only if getDepositInfo(rule contract).stake grew by `amount`. The action never reverts on a failed
///                       stake (no return data is copied, failures are only counted).
///
///         Underfunded stake triggers paid by someone else (caller-pays): if the rule contract's balance is below
///         `amount` when the action runs AND the payer is not the rule contract, the trigger is recorded as SKIPPED (the key still
///         advances, so it can never be replayed) and does not count towards MAX_STAKE_ATTEMPTS, so a griefer paying stake
///         triggers on an underfunded caller-pays rule contract cannot burn its attempts. In rule-pays (payer == rule contract) every trigger
///         counts, as before: there the rule contract pays the gas, so uncounted triggers would be an unbounded drain.
///         SDK: deployRule contract({ stake: true }) funds the rule contract with >= amount in the same create call before the trigger.
///
///         Bounded cost: anyone can send the stake trigger, and the rule contract pays for each one, so at most
///         MAX_STAKE_ATTEMPTS (2) stake triggers can ever be paid; after 2 failures it stays off until the owner
///         re-enables it (`ownerReEnableStake`, ). If even the attempt record cannot be written (state gas), the action reverts, the
///         key is consumed and the condition can never be true again for it: nothing more is paid either.
///
///         FUND THE RULE CONTRACT WITH >= amount + maxCostPerTrigger BEFORE ENABLING. The protocol reserves the trigger's whole
///         max_cost from the rule contract at APPROVE (before the SENDER frame), so during the action the rule contract holds
///         balance - max_cost; addStake{value: amount} fails if that is below `amount`.
///         Needs per rule contract: maxStateGasPerFrame >= STAKE_STATE_GAS (3 fresh slots: attempt record, registry
///         stake, registry delay), maxGasPerFrame >= STAKE_EXEC_GAS, maxTriggerDataLength >= 32 (RuleFactory checks
///         these when the logic's popcornStakeConfig() reports staking on).
///
///         Owner functions: `ownerUnlockStake()` (registry.unlockStake: the
///         rule contract counts as unstaked at once and the record's staked bit is cleared), `ownerWithdrawStake(to)` (after the
///         registry's unstake delay) and `ownerReEnableStake()` (turns the counted attempts into "skipped" ones so the attempt
///         counter restarts at 0 while the nonce key keeps advancing: the next stake trigger uses a FRESH key; resetting the
///         counter would reuse the consumed keys base|0 and base|1 whose sequence is already 1).
abstract contract RuleStake is RuleOwner {
    /// @notice popArgs of the built-in stake trigger: keccak256("popcorn.stake.trigger").
    bytes32 public constant STAKE_POP_ARGS = 0x9dd788feded4e6aa42613b012c5b0c4fc54b7a00cd0610258a6f60f98bee4894;
    /// @notice Stake trigger nonce key = this | attempts. ASCII "popcorn.stake.key" left-aligned, low bytes zero.
    uint256 public constant STAKE_NONCE_KEY_BASE = uint256(bytes32("popcorn.stake.key"));
    uint256 public constant MAX_STAKE_ATTEMPTS = 2;
    uint256 public constant STAKE_STATE_GAS = 3 * 97_920;
    uint256 public constant STAKE_EXEC_GAS = 80_000;
    /// @dev keccak256("popcorn.rule contract.stake"): bit 0 = staked, bits 1..127 = counted attempts, bits 128.. = skipped
    ///      (underfunded, paid by someone else; ).
    bytes32 internal constant STAKE_SLOT = 0xc89bfe4f9811a0d0750732170b5c9fc8bbcfc18b93dd900da4e8ad761f212a37;
    /// @notice The devnet's registry (core/SPEC.md §11).
    address internal constant DEVNET_STAKING_REGISTRY = 0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F;

    event RuleContractStaked(address indexed registry, uint256 amount, uint32 unstakeDelaySec);
    event RuleContractStakeFailed(address indexed registry, uint256 amount, uint256 attempt);
    event RuleContractStakeSkipped(address indexed registry, uint256 amount, uint256 balance);

    /// @notice Override to enable the stake trigger: (registry, amount in wei, unstake delay in seconds). Must not read
    ///         rule contract storage (it is also called on the logic contract directly, by popcornStakeConfig()).
    function _stakeConfig() internal view virtual returns (address registry, uint256 amount, uint32 unstakeDelaySec) {
        return (DEVNET_STAKING_REGISTRY, 0, 0);
    }

    /// @notice The stake configuration, for the factory and the SDK (call it on the logic contract).
    function popcornStakeConfig() external view returns (address registry, uint256 amount, uint32 unstakeDelaySec) {
        return _stakeConfig();
    }

    function _isStakePop(bytes calldata popArgs) internal pure returns (bool) {
        return popArgs.length == 32 && bytes32(popArgs) == STAKE_POP_ARGS;
    }

    function _stakeState() internal view returns (uint256 s) {
        bytes32 slot = STAKE_SLOT;
        assembly ("memory-safe") {
            s := sload(slot)
        }
    }

    /// @notice True once the rule contract's stake trigger succeeded (the rule contract's own record; the registry is the truth).
    function _staked() internal view returns (bool) {
        return _stakeState() & 1 == 1;
    }

    uint256 private constant COUNT_MASK = (uint256(1) << 127) - 1;

    /// @notice Counted (failed or successful) stake attempts: bounded by MAX_STAKE_ATTEMPTS.
    function _stakeAttempts() internal view returns (uint256) {
        return (_stakeState() >> 1) & COUNT_MASK;
    }

    /// @notice Underfunded stake triggers paid by someone else (not counted).
    function _stakeSkipped() internal view returns (uint256) {
        return _stakeState() >> 128;
    }

    function _stakeNonceKey() internal view returns (uint256) {
        return STAKE_NONCE_KEY_BASE | (_stakeAttempts() + _stakeSkipped());
    }

    function _stakeCondition() internal view returns (bool) {
        (address registry, uint256 amount,) = _stakeConfig();
        uint256 s = _stakeState();
        return amount > 0 && s & 1 == 0 && ((s >> 1) & COUNT_MASK) < MAX_STAKE_ATTEMPTS && registry.code.length > 0;
    }

    function _registryStake(address registry) private view returns (uint256 st) {
        bytes memory data = abi.encodeCall(IStakingRegistry.getDepositInfo, (address(this)));
        assembly ("memory-safe") {
            // returns (uint256, uint32, uint64): only the first word is read; nothing else is copied
            if staticcall(50000, registry, add(data, 0x20), mload(data), 0, 0x20) { st := mload(0) }
        }
    }

    /// @param payer_ the payer Core passed to __action (the rule contract itself in rule-pays)
    function _stakeAction(address payer_) internal {
        (address registry, uint256 amount, uint32 delay) = _stakeConfig();
        bytes32 slot = STAKE_SLOT;
        uint256 skipped = _stakeSkipped();
        if (payer_ != address(this) && address(this).balance < amount) {
            // someone else paid for a stake trigger the rule contract cannot fund: advance the key, do not count the attempt
            uint256 s = _stakeState() + (uint256(1) << 128);
            assembly ("memory-safe") {
                sstore(slot, s)
            }
            emit RuleContractStakeSkipped(registry, amount, address(this).balance);
            return;
        }
        uint256 attempt = _stakeAttempts() + 1;
        uint256 rec = (skipped << 128) | (attempt << 1);
        assembly ("memory-safe") {
            sstore(slot, rec) // record the attempt before anything can fail
        }
        bool ok;
        if (registry.code.length > 0) {
            uint256 before = _registryStake(registry);
            bytes memory data = abi.encodeCall(IStakingRegistry.addStake, (delay));
            assembly ("memory-safe") {
                ok := call(gas(), registry, amount, add(data, 0x20), mload(data), 0, 0) // no return data copied
            }
            ok = ok && _registryStake(registry) >= before + amount;
        }
        if (ok) {
            assembly ("memory-safe") {
                sstore(slot, or(rec, 1))
            }
            emit RuleContractStaked(registry, amount, delay);
        } else {
            emit RuleContractStakeFailed(registry, amount, attempt);
        }
    }

    // ------------------------------------------------------------------ owner functions

    event StakeUnlocked(address indexed registry);
    event StakeWithdrawn(address indexed registry, address indexed to);
    event StakeReEnabled(uint256 skipped);

    error RegistryCallFailed();

    /// @notice Starts the unstake delay at the registry; the rule contract counts as unstaked at once, so its record is cleared AND
    ///         the stake trigger is switched off (attempts := MAX_STAKE_ATTEMPTS): otherwise anyone could trigger a re-stake (the
    ///         registry's addStake clears a pending withdrawal) and undo the unlock. The next unused key stays unused: every
    ///         trigger advances attempts + skipped by one, and this only raises it. `ownerReEnableStake` turns it back on.
    function ownerUnlockStake() external onlyOwnerCall {
        (address registry,,) = _stakeConfig();
        bytes32 slot = STAKE_SLOT;
        uint256 s = ((_stakeState() >> 128) << 128) | (MAX_STAKE_ATTEMPTS << 1);
        assembly ("memory-safe") {
            sstore(slot, s)
        }
        (bool ok,) = registry.call(abi.encodeCall(IStakingRegistry.unlockStake, ()));
        if (!ok) revert RegistryCallFailed();
        emit StakeUnlocked(registry);
    }

    /// @notice Returns the stake to `to` after the unstake delay (the registry reverts before it).
    function ownerWithdrawStake(address payable to) external onlyOwnerCall {
        (address registry,,) = _stakeConfig();
        (bool ok,) = registry.call(abi.encodeCall(IStakingRegistry.withdrawStake, (to)));
        if (!ok) revert RegistryCallFailed();
        emit StakeWithdrawn(registry, to);
    }

    /// @notice Re-enables the built-in stake trigger: counted attempts become uncounted ("skipped") ones, so the counter
    ///         restarts at 0 and the nonce key (BASE | attempts + skipped) continues with an unused value. Keeps the
    ///         staked bit. At most MAX_STAKE_ATTEMPTS more paid stake triggers follow.
    function ownerReEnableStake() external onlyOwnerCall {
        bytes32 slot = STAKE_SLOT;
        uint256 s = _stakeState();
        uint256 skipped = (s >> 128) + ((s >> 1) & COUNT_MASK);
        uint256 n = (skipped << 128) | (s & 1);
        assembly ("memory-safe") {
            sstore(slot, n)
        }
        emit StakeReEnabled(skipped);
    }
}
