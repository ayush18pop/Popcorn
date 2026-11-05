// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IntentSigner} from "src/signers/IntentSigner.sol";
import {ForsLib} from "src/signers/lib/ForsLib.sol";

/// @notice "This FORS key signed this intent" (post-quantum, few-time: at most 8 signatures per key, one per ruleEpoch).
///         params: pk (32) ++ pubSeed (32) ++ firstEpoch (32) ++ chainId (32) ++ ruleId (32); the key is bound on chain to that chain and rule. The key is valid for ruleEpoch in [firstEpoch, firstEpoch + 8).
///         witness: ForsLib's 6,944-byte signature over keccak256-bound digest (see ForsLib). Message = the intent digest.
///         Stateless: the contract cannot count signatures; the epoch window is what bounds them (one trigger per epoch) and the SDK
///         signer refuses to sign two different digests for one epoch or a ninth epoch.
contract ForsSigner is IntentSigner {
    function _check(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        internal
        view
        override
        returns (bool)
    {
        if (params.length != 160) return false;
        (bool ok, bytes32 digest, uint256 epoch, uint256 ruleId) = _intent(ruleContract, context);
        if (!ok) return false;
        uint256 first = uint256(bytes32(params[64:96]));
        if (epoch < first || epoch - first >= ForsLib.MAX_SIGNATURES) return false;
        if (block.chainid != uint256(bytes32(params[96:128])) || ruleId != uint256(bytes32(params[128:160]))) return false;
        return ForsLib.verify(bytes32(params[0:32]), bytes32(params[32:64]), digest, witness);
    }
}
