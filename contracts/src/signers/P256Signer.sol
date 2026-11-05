// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IntentSigner} from "src/signers/IntentSigner.sol";
import {Schemes} from "src/signers/lib/Schemes.sol";

/// @notice "This P-256 key signed this intent" (raw ECDSA over the digest, via the P256VERIFY precompile, EIP-7951).
///         params: x ++ y (64 bytes). witness: r ++ s (64 bytes), s <= n/2.
contract P256Signer is IntentSigner {
    function _check(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        internal
        view
        override
        returns (bool)
    {
        (bool ok, bytes32 digest, uint256 epoch, uint256 ruleId) = _intent(ruleContract, context);
        return ok && Schemes.verify(Schemes.P256, params, digest, epoch, ruleId, witness);
    }
}
