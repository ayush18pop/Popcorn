// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IntentSigner} from "src/signers/IntentSigner.sol";
import {SphincsLib} from "src/signers/lib/SphincsLib.sol";

/// @notice "This SPHINCS+-style key signed this intent" (post-quantum, STATELESS: no epoch binding needed, up to 2^20 signatures per key). OUR OWN
///         keccak construction, not the NIST SLH-DSA encoding (see SphincsLib).
///         params: pubSeed (32) ++ root (32, the 16-byte root left-aligned)
///         witness: 5,200 bytes (SphincsLib.SIG_BYTES) over the intent digest
contract SphincsSigner is IntentSigner {
    function _check(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        internal
        view
        override
        returns (bool)
    {
        if (params.length != 64) return false;
        (bool ok, bytes32 digest,,) = _intent(ruleContract, context);
        return ok && SphincsLib.verify(bytes32(params[0:32]), bytes32(params[32:64]), digest, witness);
    }
}
