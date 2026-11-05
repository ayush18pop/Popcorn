// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {ICondition} from "src/interfaces/ICondition.sol";
import {IntentDigest} from "src/signers/IntentDigest.sol";

/// @title SignedIntentCondition
/// @notice condition() = "the key(s) named in this rule's params signed this exact trigger". The signature (the witness) travels in the
///         trigger's verifyData and is checked by a stateless signer (src/signers: ECDSA, P256, WebAuthn, WOTS+, hybrid,
///         multisig, attested fact, and the post-quantum schemes) that this rule contract STATICCALLs with
///         check(params, context, witness), context = abi.encode(ruleId, ruleEpoch, keccak256(popArgs)) (IntentDigest).
///
///         Replay rules, all enforced here, not by the signer:
///           - one epoch per rule, kept in the rule contract's own storage; the nonce key is keccak256(domain, ruleId, epoch), so a rule
///             has exactly one valid trigger per epoch, and `_consumeIntent` (call it FIRST in action()) bumps the epoch;
///             a signature for epoch e is dead once the trigger for e has run (its digest names e, the rule contract now asks for e + 1)
///           - the digest names the rule contract and chain (the predicate sees them), the rule and the exact popArgs
///           - the triggerer cannot change what was signed: popArgs are in the digest. verifyData is never trusted on its own.
///         The triggerer picks `ruleId` through `_ruleId(popArgs)`; a rule is whatever the developer's `_intentSigner(ruleId)` and
///         `_intentParams(ruleId)` say, so keep the set of rules finite (return a rule-count check in `_intentParams` by reverting
///         for an unknown id: a revert makes the condition false).
///
///         Mempool: the predicate is called with STATICCALL and reads no storage, the rule contract reads only its own epoch slot, so the
///         trigger is "canonical" when the predicate's work fits the VERIFY budget.
///         Params live in the logic's code or immutables, or in a code blob (`ParamsBlob`, read with EXTCODECOPY).
abstract contract SignedIntentCondition is RuleContract {
    /// @dev ERC-7201 style namespace of the per-rule epochs (rule contract storage).
    bytes32 internal constant INTENT_EPOCH_NS = keccak256("popcorn.signedIntent.epoch");
    bytes32 internal constant INTENT_KEY_DOMAIN = keccak256("popcorn.signedIntent.nonceKey");

    event IntentConsumed(uint256 indexed ruleId, uint256 epoch);

    /// @notice The predicate contract for this rule (the default `_checkIntent`). Revert for an unknown rule.
    function _intentSigner(uint256 ruleId) internal view virtual returns (address) {
        ruleId;
        revert NotImplemented();
    }

    /// @notice The predicate's params for this rule (e.g. the signer's key). Revert for an unknown rule.
    function _intentParams(uint256 ruleId) internal view virtual returns (bytes memory) {
        ruleId;
        revert NotImplemented();
    }

    /// @notice Which rule a trigger names. Default: a single rule 0. Multi-rule rule contracts read it from popArgs (e.g. its first word).
    function _ruleId(bytes calldata popArgs) internal view virtual returns (uint256) {
        popArgs;
        return 0;
    }

    function _epochSlot(uint256 ruleId) internal pure returns (bytes32) {
        return keccak256(abi.encode(INTENT_EPOCH_NS, ruleId));
    }

    /// @notice The epoch the next trigger of `ruleId` must be signed for (rule contract storage; starts at 0).
    function _ruleEpoch(uint256 ruleId) internal view returns (uint256) {
        return _sload(_epochSlot(ruleId));
    }

    /// @notice abi.encode(ruleId, ruleEpoch, keccak256(popArgs)): the context the predicate checks the signature against.
    function _intentContext(uint256 ruleId, uint256 epoch, bytes calldata popArgs) internal pure returns (bytes memory) {
        return abi.encode(ruleId, epoch, keccak256(popArgs));
    }

    function nonceKey(bytes calldata popArgs) internal view virtual override returns (uint256) {
        uint256 ruleId = _ruleId(popArgs);
        return uint256(keccak256(abi.encode(INTENT_KEY_DOMAIN, ruleId, _ruleEpoch(ruleId))));
    }

    function condition(bytes calldata popArgs, bytes calldata verifyData) internal view virtual override returns (bool) {
        uint256 ruleId = _ruleId(popArgs);
        return _checkIntent(ruleId, _ruleEpoch(ruleId), popArgs, verifyData);
    }

    /// @notice Is `witness` a valid signature for (this rule contract, ruleId, epoch, popArgs)? Default: STATICCALL the rule's predicate.
    ///         The inline triggers (EcdsaIntentCondition, WotsIntentCondition, ForsIntentCondition, XmssIntentCondition) override it
    ///         with the scheme's library and immutable keys: no external call, no params blob (about 8k less VERIFY gas, which
    ///         is what makes WOTS+ fit the public 100k budget).
    function _checkIntent(uint256 ruleId, uint256 epoch, bytes calldata popArgs, bytes calldata witness) internal view virtual returns (bool) {
        (bool ok, bytes memory ret) = _intentSigner(ruleId).staticcall(
            abi.encodeCall(ICondition.check, (_intentParams(ruleId), _intentContext(ruleId, epoch, popArgs), witness))
        );
        return ok && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
    }

    /// @notice The digest signed for this rule contract (address(this) is the rule contract under Core's DELEGATECALL).
    function _intentDigest(uint256 ruleId, uint256 epoch, bytes calldata popArgs) internal view returns (bytes32) {
        return IntentDigest.intentDigest(address(this), ruleId, epoch, keccak256(popArgs));
    }

    /// @notice Call FIRST in action(): moves the rule to its next epoch (the consumed signature can never match again).
    function _consumeIntent(bytes calldata popArgs) internal {
        uint256 ruleId = _ruleId(popArgs);
        uint256 e = _ruleEpoch(ruleId);
        _sstore(_epochSlot(ruleId), e + 1);
        emit IntentConsumed(ruleId, e);
    }
}
