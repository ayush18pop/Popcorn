// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIntentScheme} from "src/signers/IIntentScheme.sol";
import {IntentDigest} from "src/signers/IntentDigest.sol";

/// @title IntentSigner
/// @notice Base of the signed-intent signers: stateless, no storage, no banned opcodes. `check` binds the digest to
///         msg.sender (the rule contract: the logic runs by DELEGATECALL in the rule contract's context and STATICCALLs the predicate).
///         A malformed context, params or witness returns false instead of reverting.
abstract contract IntentSigner is IIntentScheme {
    function check(bytes calldata params, bytes calldata context, bytes calldata witness) external view returns (bool) {
        return _check(msg.sender, params, context, witness);
    }

    function checkFor(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        external
        view
        returns (bool)
    {
        return _check(ruleContract, params, context, witness);
    }

    function _check(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        internal
        view
        virtual
        returns (bool);

    /// @dev (ok, digest, ruleEpoch, ruleId) for an intent context.
    function _intent(address ruleContract, bytes calldata context)
        internal
        view
        returns (bool ok, bytes32 digest, uint256 epoch, uint256 ruleId)
    {
        bytes32 argsHash;
        (ok, ruleId, epoch, argsHash) = IntentDigest.parseContext(context);
        if (ok) digest = IntentDigest.intentDigest(ruleContract, ruleId, epoch, argsHash);
    }
}
