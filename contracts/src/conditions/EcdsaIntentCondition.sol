// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignedIntentCondition} from "src/conditions/SignedIntentCondition.sol";
import {EcdsaLib} from "src/signers/lib/EcdsaLib.sol";

/// @title EcdsaIntentCondition
/// @notice Standalone signed-intent trigger: condition() = "`intentSigner` signed this trigger" (secp256k1, low-s, v 27/28). The signer is an
///         immutable; no predicate call. witness (verifyData) = r ++ s ++ v (65 bytes). The signed digest is IntentDigest's (also
///         what a wallet's eth_signTypedData_v4 produces for the PopcornIntent type).
abstract contract EcdsaIntentCondition is SignedIntentCondition {
    address public immutable intentSigner;

    constructor(address signer) {
        intentSigner = signer;
    }

    function _checkIntent(uint256 ruleId, uint256 epoch, bytes calldata popArgs, bytes calldata witness)
        internal
        view
        virtual
        override
        returns (bool)
    {
        return EcdsaLib.verify(intentSigner, _intentDigest(ruleId, epoch, popArgs), witness);
    }
}
