// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IntentSigner} from "src/signers/IntentSigner.sol";
import {Schemes} from "src/signers/lib/Schemes.sol";

/// @notice "This secp256k1 key signed this intent." params: signer address (20 bytes). witness: r ++ s ++ v (65 bytes).
contract EcdsaSigner is IntentSigner {
    function _check(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        internal
        view
        override
        returns (bool)
    {
        (bool ok, bytes32 digest, uint256 epoch, uint256 ruleId) = _intent(ruleContract, context);
        return ok && Schemes.verify(Schemes.ECDSA, params, digest, epoch, ruleId, witness);
    }
}
