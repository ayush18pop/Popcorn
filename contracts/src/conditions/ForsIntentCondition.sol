// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignedIntentCondition} from "src/conditions/SignedIntentCondition.sol";
import {ForsLib} from "src/signers/lib/ForsLib.sol";

/// @title ForsIntentCondition
/// @notice Standalone post-quantum FEW-TIME signed-intent trigger (FORS, keccak256, our own construction: see ForsLib). Valid for
///         ruleEpoch in [forsFirstEpoch, forsFirstEpoch + 8): at most 8 signatures per key. Bound to one chain id and one rule id (constructor). witness = salt ++ 24 x (leaf ++ 8 nodes) = 6,944 bytes.
abstract contract ForsIntentCondition is SignedIntentCondition {
    bytes32 public immutable forsPk;
    bytes32 public immutable forsPubSeed;
    uint256 public immutable forsFirstEpoch;
    uint256 public immutable forsChainId;
    uint256 public immutable forsRuleId;

    constructor(bytes32 pk, bytes32 pubSeed, uint256 firstEpoch, uint256 chainId, uint256 ruleId) {
        forsPk = pk;
        forsPubSeed = pubSeed;
        forsFirstEpoch = firstEpoch;
        forsChainId = chainId;
        forsRuleId = ruleId;
    }

    function _checkIntent(uint256 ruleId, uint256 epoch, bytes calldata popArgs, bytes calldata witness)
        internal
        view
        virtual
        override
        returns (bool)
    {
        if (block.chainid != forsChainId || ruleId != forsRuleId) return false;
        if (epoch < forsFirstEpoch || epoch - forsFirstEpoch >= ForsLib.MAX_SIGNATURES) return false;
        return ForsLib.verify(forsPk, forsPubSeed, _intentDigest(ruleId, epoch, popArgs), witness);
    }
}
