// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";

/// @title Hand Over To A New Key (action block)
/// @notice Moves control of the build to a new key, slowly and in public:
///           1. something the build trusts proposes a new key (`_proposeHandover`, e.g. when an Anonymous Group Vote
///              reaches its quorum);
///           2. nothing happens for `handoverDelay` seconds; in that window the current key can contest
///              (`_contestHandover`), which cancels the handover and marks the build as contested;
///           3. after the delay, anyone completes it (`_finalizeHandover`).
///
///         The key is stored as a hash (of a signer's params, or of anything the build checks a signature against), so
///         rotating it is one write and the full key is supplied with each use. "Contested" is an output another block
///         reads: in Walkaway Exit it opens Exit To An Address, so a contested takeover ends with the funds at the owner's
///         own safe address.
abstract contract KeyHandover is RuleContract {
    /// @dev slot 0: key hash; 1: pending key hash; 2: readyAt; 3: contested flag.
    bytes32 private constant SLOT = keccak256("popcorn.block.keyHandover");

    uint256 public immutable handoverDelay;

    event KeySet(bytes32 keyHash);
    event HandoverPending(bytes32 newKeyHash, uint256 readyAt);
    event HandoverContested(bytes32 cancelledKeyHash);
    event HandedOver(bytes32 newKeyHash);

    error NoPendingHandover();
    error HandoverTooEarly();
    error HandoverIsContested();

    constructor(uint256 delay) {
        handoverDelay = delay;
    }

    function _s(uint256 i) private pure returns (bytes32) {
        return bytes32(uint256(SLOT) + i);
    }

    function _setKey(bytes32 keyHash) internal {
        _sstore(_s(0), uint256(keyHash));
        emit KeySet(keyHash);
    }

    function _currentKey() internal view returns (bytes32) {
        return bytes32(_sload(_s(0)));
    }

    function _pendingKey() internal view returns (bytes32) {
        return bytes32(_sload(_s(1)));
    }

    function _handoverReadyAt() internal view returns (uint256) {
        return _sload(_s(2));
    }

    function _contested() internal view returns (bool) {
        return _sload(_s(3)) == 1;
    }

    /// @notice Starts a handover to `newKeyHash` (replaces any pending one and clears an earlier contest). Never reverts.
    function _proposeHandover(bytes32 newKeyHash) internal {
        uint256 readyAt = block.timestamp + handoverDelay;
        _sstore(_s(1), uint256(newKeyHash));
        _sstore(_s(2), readyAt);
        _sstore(_s(3), 0);
        emit HandoverPending(newKeyHash, readyAt);
    }

    /// @notice The current key's holder cancels the pending handover; the build is now contested. The caller checks the
    ///         current key's signature first.
    function _contestHandover() internal {
        bytes32 pending = _pendingKey();
        if (pending == 0) revert NoPendingHandover();
        _sstore(_s(1), 0);
        _sstore(_s(2), 0);
        _sstore(_s(3), 1);
        emit HandoverContested(pending);
    }

    /// @notice Completes an uncontested handover after the delay. Anyone may call the build's function that runs it.
    function _finalizeHandover() internal {
        bytes32 pending = _pendingKey();
        if (pending == 0) revert NoPendingHandover();
        if (_contested()) revert HandoverIsContested();
        if (block.timestamp < _handoverReadyAt()) revert HandoverTooEarly();
        _sstore(_s(0), uint256(pending));
        _sstore(_s(1), 0);
        _sstore(_s(2), 0);
        emit HandedOver(pending);
    }
}
