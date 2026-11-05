// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IntentSigner} from "src/signers/IntentSigner.sol";
import {Schemes} from "src/signers/lib/Schemes.sol";

/// @notice "This WOTS+ tree signed this intent" (post-quantum, one signature per ruleEpoch). params: root ++ pubSeed ++
///         firstEpoch (96 bytes). witness: salt ++ 67 chain values ++ 10 path nodes (2,496 bytes). Leaf = ruleEpoch - firstEpoch.
contract WotsSigner is IntentSigner {
    function _check(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        internal
        view
        override
        returns (bool)
    {
        (bool ok, bytes32 digest, uint256 epoch, uint256 ruleId) = _intent(ruleContract, context);
        return ok && Schemes.verify(Schemes.WOTS, params, digest, epoch, ruleId, witness);
    }
}
