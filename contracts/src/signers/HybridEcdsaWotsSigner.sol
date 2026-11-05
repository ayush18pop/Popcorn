// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IntentSigner} from "src/signers/IntentSigner.sol";
import {Schemes} from "src/signers/lib/Schemes.sol";

/// @notice Hybrid: BOTH an ECDSA key and a WOTS+ tree must sign the intent. params: ecdsa address (20) ++ WOTS key (160: root, pubSeed,
///         firstEpoch, chainId, ruleId) = 180 bytes. witness: r ++ s ++ v (65) ++ WOTS witness (2,496) = 2,561 bytes.
contract HybridEcdsaWotsSigner is IntentSigner {
    function _check(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        internal
        view
        override
        returns (bool)
    {
        if (params.length != 180 || witness.length != 65 + Schemes.WOTS_WITNESS) return false;
        (bool ok, bytes32 digest, uint256 epoch, uint256 ruleId) = _intent(ruleContract, context);
        if (!ok) return false;
        return Schemes.verify(Schemes.ECDSA, params[0:20], digest, epoch, ruleId, witness[0:65])
            && Schemes.verify(Schemes.WOTS, params[20:180], digest, epoch, ruleId, witness[65:]);
    }
}
