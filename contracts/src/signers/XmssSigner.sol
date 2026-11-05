// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IntentSigner} from "src/signers/IntentSigner.sol";
import {XmssLib} from "src/signers/lib/XmssLib.sol";

/// @notice "This XMSS/LMS-style key signed this intent" (post-quantum, stateful, 2^height signatures per key, one per ruleEpoch). OUR OWN
///         construction (see XmssLib): not RFC 8391 and not NIST SP 800-208; self-generated vectors.
///         params: root (32) ++ I (32, public seed) ++ firstEpoch (32) ++ height (32) ++ chainId (32) ++ ruleId (32) = 192 bytes; bound on chain to that chain and rule
///         witness: salt (32) ++ 67 chain values ++ `height` authentication nodes
///         leaf index q = ruleEpoch - firstEpoch (must be < 2^height).
contract XmssSigner is IntentSigner {
    function _check(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        internal
        view
        override
        returns (bool)
    {
        if (params.length != 192) return false;
        (bool ok, bytes32 digest, uint256 epoch, uint256 ruleId) = _intent(ruleContract, context);
        if (!ok) return false;
        uint256 first = uint256(bytes32(params[64:96]));
        uint256 height = uint256(bytes32(params[96:128]));
        if (epoch < first) return false;
        if (block.chainid != uint256(bytes32(params[128:160])) || ruleId != uint256(bytes32(params[160:192]))) return false;
        return XmssLib.verify(bytes32(params[0:32]), bytes32(params[32:64]), height, epoch - first, digest, witness);
    }
}
