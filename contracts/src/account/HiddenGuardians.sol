// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "src/interfaces/IVerifier.sol";
import {RuleContract} from "src/rules/RuleContract.sol";

/// @title HiddenGuardians
/// @notice k-of-n guardians who vote with a private membership proof: the chain learns that k members of the guardian set
///         agreed, never which ones, so no guardian can be singled out, bribed or coerced by name, and none needs ETH
///         (the account pays for the vote).
///
///         A vote proves membership in `guardiansRoot` (circuits/membership.circom) with
///           signalHash        = keccak256(abi.encode(proposal, round)) >> 8      what the guardian approves
///           externalNullifier = keccak256(abi.encode(account, round)) >> 8       one vote per guardian per round
///         The nullifier hash is the vote's nonce key, so the protocol itself refuses a second vote by the same guardian in
///         the same round. When `threshold` votes agree on one proposal, _onQuorum runs and the round advances, which
///         makes every other vote of that round invalid.
abstract contract HiddenGuardians is RuleContract {
    /// @dev keccak256("popcorn.guardians"): +0 root, +1 threshold, +2 round; votes(round, proposal) at keccak256(abi.encode(round, proposal, BASE)).
    bytes32 private constant G = 0x71ab6a2bf7b5b52f14c19f6e7d05f9fc83da6bddd181d36a906434bf7030b073;

    IVerifier public immutable membershipVerifier;

    event GuardianVote(uint256 indexed round, bytes32 indexed proposal, uint256 votes, uint256 nullifierHash);
    event GuardianQuorum(uint256 indexed round, bytes32 indexed proposal);

    constructor(IVerifier membershipVerifier_) {
        membershipVerifier = membershipVerifier_;
    }

    function _setGuardians(uint256 root, uint256 threshold) internal {
        _sstore(G, root);
        _sstore(bytes32(uint256(G) + 1), threshold);
    }

    function guardiansRoot() public view returns (uint256) {
        return _sload(G);
    }

    function guardianThreshold() public view returns (uint256) {
        return _sload(bytes32(uint256(G) + 1));
    }

    function guardianRound() public view returns (uint256) {
        return _sload(bytes32(uint256(G) + 2));
    }

    function _votesSlot(uint256 round, bytes32 proposal) private pure returns (bytes32) {
        return keccak256(abi.encode(round, proposal, G));
    }

    function guardianVotes(uint256 round, bytes32 proposal) public view returns (uint256) {
        return _sload(_votesSlot(round, proposal));
    }

    function _signalHash(bytes32 proposal, uint256 round) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(proposal, round))) >> 8;
    }

    function _externalNullifier(uint256 round) internal view returns (uint256) {
        return uint256(keccak256(abi.encode(address(this), round))) >> 8;
    }

    /// @notice Validation of a vote for `proposal` with `nullifierHash` and the proof. Own storage + the verifier.
    function _voteValid(bytes32 proposal, uint256 nullifierHash, bytes calldata proof) internal view returns (bool) {
        uint256 root = _sload(G);
        if (root == 0 || _sload(bytes32(uint256(G) + 1)) == 0) return false;
        uint256 round = _sload(bytes32(uint256(G) + 2));
        uint256[] memory inputs = new uint256[](4);
        inputs[0] = root;
        inputs[1] = nullifierHash;
        inputs[2] = _signalHash(proposal, round);
        inputs[3] = _externalNullifier(round);
        (bool s, bytes memory ret) = address(membershipVerifier).staticcall(abi.encodeCall(IVerifier.verify, (proof, inputs)));
        return s && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
    }

    /// @notice Counts a validated vote; on quorum runs _onQuorum and opens the next round.
    function _countVote(bytes32 proposal, uint256 nullifierHash) internal {
        uint256 round = _sload(bytes32(uint256(G) + 2));
        bytes32 slot = _votesSlot(round, proposal);
        uint256 v = _sload(slot) + 1;
        _sstore(slot, v);
        emit GuardianVote(round, proposal, v, nullifierHash);
        if (v >= _sload(bytes32(uint256(G) + 1))) {
            _sstore(bytes32(uint256(G) + 2), round + 1);
            emit GuardianQuorum(round, proposal);
            _onQuorum(proposal);
        }
    }

    /// @notice What a reached quorum does. Must not revert (the vote's key is already consumed).
    function _onQuorum(bytes32 proposal) internal virtual;
}
