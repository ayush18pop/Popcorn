// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IntentSigner} from "src/signers/IntentSigner.sol";
import {Schemes} from "src/signers/lib/Schemes.sol";

/// @notice "This passkey signed this intent" (WebAuthn assertion whose challenge is the digest). params: x ++ y ++ rpIdHash
///         ++ flags (128 bytes; flags bit 0 = require user verification). witness: see WebAuthnLib.
contract WebAuthnSigner is IntentSigner {
    function _check(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        internal
        view
        override
        returns (bool)
    {
        (bool ok, bytes32 digest, uint256 epoch, uint256 ruleId) = _intent(ruleContract, context);
        return ok && Schemes.verify(Schemes.WEBAUTHN, params, digest, epoch, ruleId, witness);
    }

    /// @notice Deploy-time check of a key blob: 128 bytes, a non-zero rpIdHash (rpIdHash 0 would skip the relying-party check, so any origin's
    ///         passkey with that key would pass; opt out by deploying params with a deliberately zero hash and not calling this) and flags 0 or 1.
    ///         The check never looks at the assertion's `origin` or `crossOrigin` (only the rpIdHash in authenticatorData).
    function validParams(bytes calldata params) external pure returns (bool) {
        return params.length == 128 && bytes32(params[64:96]) != bytes32(0) && uint256(bytes32(params[96:128])) <= 1;
    }
}
