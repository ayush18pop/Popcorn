// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {ICondition} from "src/interfaces/ICondition.sol";
import {IntentDigest} from "src/signers/IntentDigest.sol";
import {Answer, YES, NO, UNKNOWN} from "src/blocks/Answer.sol";

/// @title Signed Instruction, Anyone Can Send (check block)
/// @notice yes when a key signed this exact instruction (the trigger data) for this build. Anyone can then deliver it,
///         from a wallet with no ETH, and nobody can change what was signed: the trigger data is inside the digest.
///
///         The key type is an option: any signer contract in src/signers (ECDSA, passkey / P-256, WebAuthn, both keys
///         must sign, k of n keys, WOTS+, FORS, XMSS-style, SPHINCS+-style, Falcon). The signer is stateless and is called
///         with check(params, context, witness); params hold the key, the witness is the signature from the trigger's
///         verify data.
///
///         Replay: each instruction kind (`ruleId`) has an epoch in the build's own storage. The digest names the build,
///         the chain, the kind, the epoch and the exact trigger data; `_useInstruction` (call it first in the action) moves
///         the epoch on, so a signature works once. `_instructionKey(ruleId)` is the matching nonce key.
abstract contract SignedInstruction is RuleContract {
    /// @dev Per-kind epochs (storage namespace) and the nonce-key domain.
    bytes32 internal constant INTENT_EPOCH_NS = keccak256("popcorn.signedIntent.epoch");
    bytes32 internal constant INTENT_KEY_DOMAIN = keccak256("popcorn.signedIntent.nonceKey");

    event IntentConsumed(uint256 indexed ruleId, uint256 epoch);

    function _epochSlot(uint256 ruleId) internal pure returns (bytes32) {
        return keccak256(abi.encode(INTENT_EPOCH_NS, ruleId));
    }

    /// @notice The epoch the next instruction of kind `ruleId` must be signed for (starts at 0).
    function _ruleEpoch(uint256 ruleId) internal view returns (uint256) {
        return _sload(_epochSlot(ruleId));
    }

    /// @notice abi.encode(ruleId, epoch, keccak256(popArgs)): what the signer checks the signature against.
    function _intentContext(uint256 ruleId, uint256 epoch, bytes calldata popArgs) internal pure returns (bytes memory) {
        return abi.encode(ruleId, epoch, keccak256(popArgs));
    }

    /// @notice The digest signed for this build (address(this) is the build under Core's DELEGATECALL).
    function _intentDigest(uint256 ruleId, uint256 epoch, bytes calldata popArgs) internal view returns (bytes32) {
        return IntentDigest.intentDigest(address(this), ruleId, epoch, keccak256(popArgs));
    }

    /// @notice The nonce key of the next instruction of kind `ruleId`.
    function _instructionKey(uint256 ruleId) internal view returns (uint256) {
        return uint256(keccak256(abi.encode(INTENT_KEY_DOMAIN, ruleId, _ruleEpoch(ruleId))));
    }

    /// @notice yes when `signer` accepts `witness` for (this build, ruleId, its current epoch, popArgs).
    function _signedInstruction(address signer, bytes memory params, uint256 ruleId, bytes calldata popArgs, bytes calldata witness)
        internal
        view
        returns (Answer)
    {
        return _signerSays(signer, params, _intentContext(ruleId, _ruleEpoch(ruleId), popArgs), witness);
    }

    /// @notice The signer's answer for an explicit context (a build that binds a signature to its own epoch, such as a
    ///         contest bound to a vote round). A signer that reverts or returns junk is unknown.
    function _signerSays(address signer, bytes memory params, bytes memory context, bytes memory witness) internal view returns (Answer) {
        (bool ok, bytes memory ret) = signer.staticcall(abi.encodeCall(ICondition.check, (params, context, witness)));
        if (!ok || ret.length != 32) return UNKNOWN;
        return abi.decode(ret, (uint256)) == 1 ? YES : NO;
    }

    /// @notice Call FIRST in the action: the signature that was just used can never match again.
    function _useInstruction(uint256 ruleId) internal {
        uint256 e = _ruleEpoch(ruleId);
        _sstore(_epochSlot(ruleId), e + 1);
        emit IntentConsumed(ruleId, e);
    }
}
