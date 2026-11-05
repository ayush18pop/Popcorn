// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignedIntentCondition} from "src/conditions/SignedIntentCondition.sol";
import {Schemes} from "src/signers/lib/Schemes.sol";

/// @title WotsIntentCondition
/// @notice Standalone post-quantum signed-intent trigger: condition() = "this WOTS+ tree signed this trigger" (hash-based, keccak256;
///         the scheme of Core's owner path). The key is three immutables (no params blob, no predicate call), so it costs about 8k
///         less VERIFY gas than WotsSigner behind SignedIntentCondition: the version that fits the public 100k budget (the signer
///         grinds the salt). Leaf = ruleEpoch - firstEpoch: one signature per epoch, 1,024 epochs. The key is bound to one chain id and one rule id (constructor): other rules always fail,
///         so a tree can never be asked for two messages on one leaf through two rules. The rule contract address cannot be bound (hash cycle): see Schemes.sol.
///         witness (verifyData) = salt (32) ++ 67 chain values ++ 10 path nodes = 2,496 bytes.
abstract contract WotsIntentCondition is SignedIntentCondition {
    bytes32 public immutable wotsRoot;
    bytes32 public immutable wotsPubSeed;
    uint256 public immutable wotsFirstEpoch;
    uint256 public immutable wotsChainId;
    uint256 public immutable wotsRuleId;

    constructor(bytes32 root, bytes32 pubSeed, uint256 firstEpoch, uint256 chainId, uint256 ruleId) {
        wotsRoot = root;
        wotsPubSeed = pubSeed;
        wotsFirstEpoch = firstEpoch;
        wotsChainId = chainId;
        wotsRuleId = ruleId;
    }

    function _checkIntent(uint256 ruleId, uint256 epoch, bytes calldata popArgs, bytes calldata witness)
        internal
        view
        virtual
        override
        returns (bool)
    {
        return Schemes.verifyWots(wotsRoot, wotsPubSeed, wotsFirstEpoch, wotsChainId, wotsRuleId, _intentDigest(ruleId, epoch, popArgs), epoch, ruleId, witness);
    }
}
