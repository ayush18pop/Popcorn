// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {IVerifier} from "src/interfaces/IVerifier.sol";
import {Answer, YES, NO, UNKNOWN} from "src/blocks/Answer.sol";

/// @title Proof That The Rules Were Broken (check block)
/// @notice yes when a zero-knowledge proof shows that the target's rules can be broken from its live state, without
///         revealing how. Which rules is the target's business: the build supplies the circuit's public inputs from the
///         target's own state (`_rulesInputs`), and the block binds every claim to a recipient and a claim id that are
///         public inputs too, so a proof for one recipient cannot pay another and a copier gains nothing.
///
///         claim (trigger data) = abi.encode(address recipient, uint64 claimId);  proof (verify data) = the proof bytes.
///
///         One payout per broken state is the build's job: key the claim on an epoch the action moves forward (Pause The
///         Target's pause epoch), and answer no while the target is paused.
///
///         Zero-knowledge, not post-quantum: a Groth16 proof hides the exploit but a quantum computer could forge one.
///         A Groth16 check costs about 200k gas: the build runs on the alternative mempool and stakes.
abstract contract RulesBrokenProof is RuleContract {
    /// @notice The proof verifier (circuit-specific). address(0) turns the block off: every claim is no.
    IVerifier public immutable rulesVerifier;

    uint256 public constant CLAIM_LENGTH = 64;

    constructor(IVerifier verifier_) {
        rulesVerifier = verifier_;
    }

    /// @notice The circuit's public inputs for a claim, built from the target's live state, address(this), the recipient and
    ///         the claim id. Never from the proof itself.
    function _rulesInputs(address recipient, uint256 claimId) internal view virtual returns (uint256[] memory);

    /// @notice The recipient a claim names (bound in the proof, so it is safe to pay).
    function _claimRecipient(bytes calldata claim) internal pure returns (address) {
        return _address(claim, 0);
    }

    function _rulesBroken(bytes calldata claim, bytes calldata proof) internal view returns (Answer) {
        if (address(rulesVerifier) == address(0) || claim.length != CLAIM_LENGTH) return NO;
        uint256 claimId = _word(claim, 1);
        if (claimId >= 1 << 64) return NO;
        uint256[] memory inputs = _rulesInputs(_claimRecipient(claim), claimId);
        (bool ok, bytes memory ret) = address(rulesVerifier).staticcall(abi.encodeCall(IVerifier.verify, (proof, inputs)));
        if (!ok || ret.length != 32) return UNKNOWN;
        return abi.decode(ret, (uint256)) == 1 ? YES : NO;
    }
}
