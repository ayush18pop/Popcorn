// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "src/interfaces/IVerifier.sol";
import {GroupMembership} from "src/blocks/checks/GroupMembership.sol";
import {Answer, NO} from "src/blocks/Answer.sol";

/// @title Anonymous Group Vote (action block)
/// @notice k of n members agree on a proposal, and the chain never learns which members voted, so none of them can be
///         singled out, bribed or pressured by name, and none needs ETH (the build pays for the vote). When k votes agree,
///         `_onQuorum(proposal)` runs: that is where the build plugs in the next block (hand over to a new key, flip the
///         quantum switch, pause a protocol).
///
///         A vote is a Prove You're In The Group proof with
///           signalHash        = keccak256(abi.encode(proposal, round)) >> 8      what the member approves
///           externalNullifier = keccak256(abi.encode(build, round)) >> 8         one vote per member per round
///         Use the nullifier hash as the vote trigger's nonce key: the protocol itself refuses a second vote by the same member
///         in the same round. Reaching quorum opens the next round, which makes every other vote of the old round invalid.
///
///         Uses: guardians who recover an account, a security council that pauses a protocol, a DAO committee.
abstract contract AnonymousGroupVote is GroupMembership {
    /// @dev slot 0: group root; 1: threshold k; 2: round. votes(round, proposal) at keccak256(abi.encode(round, proposal, SLOT)).
    bytes32 private constant SLOT = keccak256("popcorn.block.anonymousGroupVote");

    event GroupSet(uint256 root, uint256 threshold);
    event GroupVote(uint256 indexed round, bytes32 indexed proposal, uint256 votes, uint256 nullifierHash);
    event GroupQuorum(uint256 indexed round, bytes32 indexed proposal);

    constructor(IVerifier membershipVerifier_) GroupMembership(membershipVerifier_) {}

    function _setGroup(uint256 root, uint256 threshold) internal {
        _sstore(SLOT, root);
        _sstore(bytes32(uint256(SLOT) + 1), threshold);
        emit GroupSet(root, threshold);
    }

    function _groupRoot() internal view returns (uint256) {
        return _sload(SLOT);
    }

    function _voteThreshold() internal view returns (uint256) {
        return _sload(bytes32(uint256(SLOT) + 1));
    }

    function _voteRound() internal view returns (uint256) {
        return _sload(bytes32(uint256(SLOT) + 2));
    }

    function _votesSlot(uint256 round, bytes32 proposal) private pure returns (bytes32) {
        return keccak256(abi.encode(round, proposal, SLOT));
    }

    function _votesFor(uint256 round, bytes32 proposal) internal view returns (uint256) {
        return _sload(_votesSlot(round, proposal));
    }

    function _voteSignal(bytes32 proposal, uint256 round) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(proposal, round))) >> 8;
    }

    function _voteScope(uint256 round) internal view returns (uint256) {
        return uint256(keccak256(abi.encode(address(this), round))) >> 8;
    }

    /// @notice Check side: is this a valid vote for `proposal` in the current round? Own storage plus the verifier.
    function _voteValid(bytes32 proposal, uint256 nullifierHash, bytes memory proof) internal view returns (Answer) {
        if (_voteThreshold() == 0) return NO;
        uint256 round = _voteRound();
        return _inGroup(_groupRoot(), nullifierHash, _voteSignal(proposal, round), _voteScope(round), proof);
    }

    /// @notice Action side: counts a validated vote; on quorum opens the next round and runs `_onQuorum`.
    function _countVote(bytes32 proposal, uint256 nullifierHash) internal {
        uint256 round = _voteRound();
        bytes32 slot = _votesSlot(round, proposal);
        uint256 v = _sload(slot) + 1;
        _sstore(slot, v);
        emit GroupVote(round, proposal, v, nullifierHash);
        if (v >= _voteThreshold()) {
            _sstore(bytes32(uint256(SLOT) + 2), round + 1);
            emit GroupQuorum(round, proposal);
            _onQuorum(proposal);
        }
    }

    /// @notice What a reached quorum does. Must not revert (the vote's key is already spent).
    function _onQuorum(bytes32 proposal) internal virtual;
}
