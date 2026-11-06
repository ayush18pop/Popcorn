// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {IPausable} from "src/interfaces/IPausable.sol";

/// @title Pause The Target (action block)
/// @notice Stops a protocol. Two ways, same block:
///           - the target is the build itself (a vault that guards itself): `_pauseSelf()` sets a flag in the block's own
///             storage, guards the target's functions with `whenNotPaused`, and opens a new pause epoch. A check that
///             reads the flag reads the build's own storage, so it stays on the public mempool.
///           - the target is another contract that implements IPausable and lets the build pause it: `_pauseOther(t)`,
///             best effort.
///
///         Reopening is never automatic: `_reopen()` is for the build's owner path, and it refuses while the build's
///         `_safeToReopen()` says the target is still broken (otherwise a broken target reopened would let the attacker
///         continue and pay a reward on every new pause).
///
///         The pause epoch is what the build keys its triggers on: one payout and one pause per broken state.
abstract contract PauseTarget is RuleContract {
    /// @dev slot 0: paused (bit 0) | pauseEpoch << 1.
    bytes32 private constant SLOT = keccak256("popcorn.block.pauseTarget");
    /// @notice Gas given to an outside target's pause().
    uint256 public constant PAUSE_CALL_GAS = 100_000;

    event TargetPaused(uint256 indexed epoch);
    event TargetReopened(uint256 indexed epoch);
    event OtherTargetPaused(address indexed target, bool ok);

    error TargetIsPaused();
    error TargetNotPaused();
    error NotSafeToReopen();

    modifier whenNotPaused() {
        if (_isPaused()) revert TargetIsPaused();
        _;
    }

    function _isPaused() internal view returns (bool) {
        return _sload(SLOT) & 1 == 1;
    }

    /// @notice The current pause epoch: it moves forward each time the target is paused.
    function _pauseEpoch() internal view returns (uint256) {
        return _sload(SLOT) >> 1;
    }

    /// @notice A nonce key that changes every pause: `domain` separates the build's trigger kinds.
    function _pauseKey(bytes32 domain) internal view returns (uint256) {
        return uint256(keccak256(abi.encode(domain, address(this), _pauseEpoch())));
    }

    /// @notice Pauses the build itself and opens the next epoch. Returns the epoch that just ended.
    function _pauseSelf() internal returns (uint256 epoch) {
        epoch = _pauseEpoch();
        _sstore(SLOT, ((epoch + 1) << 1) | 1);
        emit TargetPaused(epoch);
    }

    /// @notice Reopens the build itself (an owner path). Refused while `_safeToReopen()` is false.
    function _reopen() internal {
        if (!_isPaused()) revert TargetNotPaused();
        if (!_safeToReopen()) revert NotSafeToReopen();
        uint256 epoch = _pauseEpoch();
        _sstore(SLOT, epoch << 1);
        emit TargetReopened(epoch);
    }

    /// @notice Whether the target is healthy enough to reopen. Default: yes. A build that pauses on a broken invariant
    ///         returns "the invariant holds again".
    function _safeToReopen() internal view virtual returns (bool) {
        return true;
    }

    /// @notice Pauses another contract, best effort (never reverts the action).
    function _pauseOther(IPausable target) internal returns (bool ok) {
        (ok,) = address(target).call{gas: PAUSE_CALL_GAS}(abi.encodeCall(IPausable.pause, ()));
        emit OtherTargetPaused(address(target), ok);
    }

    // ------------------------------------------------------------------ views (forwarded)

    function paused() external view returns (bool) {
        return _isPaused();
    }

    function pauseEpoch() external view returns (uint64) {
        return uint64(_pauseEpoch());
    }
}
