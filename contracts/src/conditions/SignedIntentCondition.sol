// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignedInstruction} from "src/blocks/checks/SignedInstruction.sol";

/// @title SignedIntentCondition
/// @notice The shortest build there is: one Signed Instruction block as the whole condition. condition() = "the key(s) named
///         in this rule's params signed this exact trigger"; the nonce key is the instruction's epoch key. The developer
///         names the signer and its params per rule and calls `_consumeIntent` first in action().
///
///         Replay rules, all enforced by the block (src/blocks/checks/SignedInstruction.sol), not by the signer:
///           - one epoch per rule in the build's own storage; the key is keccak256(domain, ruleId, epoch), so a rule has
///             exactly one valid trigger per epoch, and `_consumeIntent` bumps the epoch
///           - the digest names the build and chain (the signer sees them), the rule and the exact popArgs
///         The triggerer picks `ruleId` through `_ruleId(popArgs)`; keep the set of rules finite (revert in `_intentParams`
///         for an unknown id: a revert makes the condition false).
///
///         The inline conditions (EcdsaIntentCondition, WotsIntentCondition, ForsIntentCondition, XmssIntentCondition)
///         override `_checkIntent` with the scheme's library and immutable keys: no external call (about 8k less VERIFY gas,
///         which is what makes WOTS+ fit the public 100k budget).
abstract contract SignedIntentCondition is SignedInstruction {
    /// @notice The signer contract for this rule (the default `_checkIntent`). Revert for an unknown rule.
    function _intentSigner(uint256 ruleId) internal view virtual returns (address) {
        ruleId;
        revert NotImplemented();
    }

    /// @notice The signer's params for this rule (e.g. the key). Revert for an unknown rule.
    function _intentParams(uint256 ruleId) internal view virtual returns (bytes memory) {
        ruleId;
        revert NotImplemented();
    }

    /// @notice Which rule a trigger names. Default: a single rule 0. Multi-rule builds read it from popArgs (e.g. its first word).
    function _ruleId(bytes calldata popArgs) internal view virtual returns (uint256) {
        popArgs;
        return 0;
    }

    function nonceKey(bytes calldata popArgs) internal view virtual override returns (uint256) {
        return _instructionKey(_ruleId(popArgs));
    }

    function condition(bytes calldata popArgs, bytes calldata verifyData) internal view virtual override returns (bool) {
        uint256 ruleId = _ruleId(popArgs);
        return _checkIntent(ruleId, _ruleEpoch(ruleId), popArgs, verifyData);
    }

    /// @notice Is `witness` a valid signature for (this build, ruleId, epoch, popArgs)? Default: the Signed Instruction block
    ///         with the rule's signer contract.
    function _checkIntent(uint256 ruleId, uint256 epoch, bytes calldata popArgs, bytes calldata witness) internal view virtual returns (bool) {
        return _signerSays(_intentSigner(ruleId), _intentParams(ruleId), _intentContext(ruleId, epoch, popArgs), witness).isYes();
    }

    /// @notice Call FIRST in action(): moves the rule to its next epoch (the consumed signature can never match again).
    function _consumeIntent(bytes calldata popArgs) internal {
        _useInstruction(_ruleId(popArgs));
    }
}
