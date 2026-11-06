// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {IVerifier} from "src/interfaces/IVerifier.sol";
import {Answer, YES, NO, UNKNOWN} from "src/blocks/Answer.sol";

/// @title Prove You're In The Group (check block)
/// @notice yes when a zero-knowledge proof shows the sender is one of a group (a Poseidon Merkle root) without saying which
///         member, approving `signal` once per `scope`. The proof's nullifier hash is the same every time the same member
///         proves for the same scope, so a build that uses it as the nonce key gets "once per member" from the protocol
///         itself (EIP-8250 keyed nonces): a second proof by the same member is refused before it runs.
///
///         Option: the group root can be an association set (a published list of accepted deposits): "my deposit is one
///         of the accepted ones", as in Private Pool.
///
///         Circuit: packages/zk/circuits/membership.circom, public inputs [root, nullifierHash, signalHash, externalNullifier].
///         Zero-knowledge, not post-quantum. A Groth16 check costs about 200k gas: alternative mempool, staked build.
abstract contract GroupMembership is RuleContract {
    IVerifier public immutable membershipVerifier;

    constructor(IVerifier membershipVerifier_) {
        membershipVerifier = membershipVerifier_;
    }

    /// @notice A field element for `x` (the circuit's signal and scope are 248-bit).
    function _field(bytes32 x) internal pure returns (uint256) {
        return uint256(x) >> 8;
    }

    function _inGroup(uint256 root, uint256 nullifierHash, uint256 signalHash, uint256 externalNullifier, bytes memory proof)
        internal
        view
        returns (Answer)
    {
        if (root == 0) return NO;
        uint256[] memory inputs = new uint256[](4);
        inputs[0] = root;
        inputs[1] = nullifierHash;
        inputs[2] = signalHash;
        inputs[3] = externalNullifier;
        (bool ok, bytes memory ret) = address(membershipVerifier).staticcall(abi.encodeCall(IVerifier.verify, (proof, inputs)));
        if (!ok || ret.length != 32) return UNKNOWN;
        return abi.decode(ret, (uint256)) == 1 ? YES : NO;
    }
}
