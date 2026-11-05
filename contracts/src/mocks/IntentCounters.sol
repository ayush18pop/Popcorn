// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {SignedIntentCondition} from "src/conditions/SignedIntentCondition.sol";
import {IntentCounter} from "src/examples/IntentCounter.sol";
import {EcdsaIntentCondition} from "src/conditions/EcdsaIntentCondition.sol";
import {WotsIntentCondition} from "src/conditions/WotsIntentCondition.sol";
import {ForsIntentCondition} from "src/conditions/ForsIntentCondition.sol";
import {XmssIntentCondition} from "src/conditions/XmssIntentCondition.sol";

/// Concrete rule contracts for the tests and the gas table: the IntentCounter action with each inline signed-intent trigger.
/// (The three overrides per contract only pick which base's version wins; Solidity requires them for this diamond.)

contract EcdsaIntentCounter is IntentCounter, EcdsaIntentCondition {
    constructor(address signer) EcdsaIntentCondition(signer) {}

    function _checkIntent(uint256 r, uint256 e, bytes calldata a, bytes calldata w) internal view override(SignedIntentCondition, EcdsaIntentCondition) returns (bool) {
        return EcdsaIntentCondition._checkIntent(r, e, a, w);
    }

    function _ruleId(bytes calldata p) internal pure override(SignedIntentCondition, IntentCounter) returns (uint256) {
        return IntentCounter._ruleId(p);
    }

    function action(bytes calldata p, address a) internal override(RuleContract, IntentCounter) {
        IntentCounter.action(p, a);
    }
}

contract WotsIntentCounter is IntentCounter, WotsIntentCondition {
    constructor(bytes32 root, bytes32 pubSeed, uint256 firstEpoch, uint256 chainId, uint256 ruleId) WotsIntentCondition(root, pubSeed, firstEpoch, chainId, ruleId) {}

    function _checkIntent(uint256 r, uint256 e, bytes calldata a, bytes calldata w) internal view override(SignedIntentCondition, WotsIntentCondition) returns (bool) {
        return WotsIntentCondition._checkIntent(r, e, a, w);
    }

    function _ruleId(bytes calldata p) internal pure override(SignedIntentCondition, IntentCounter) returns (uint256) {
        return IntentCounter._ruleId(p);
    }

    function action(bytes calldata p, address a) internal override(RuleContract, IntentCounter) {
        IntentCounter.action(p, a);
    }
}

contract ForsIntentCounter is IntentCounter, ForsIntentCondition {
    constructor(bytes32 pk, bytes32 pubSeed, uint256 firstEpoch, uint256 chainId, uint256 ruleId) ForsIntentCondition(pk, pubSeed, firstEpoch, chainId, ruleId) {}

    function _checkIntent(uint256 r, uint256 e, bytes calldata a, bytes calldata w) internal view override(SignedIntentCondition, ForsIntentCondition) returns (bool) {
        return ForsIntentCondition._checkIntent(r, e, a, w);
    }

    function _ruleId(bytes calldata p) internal pure override(SignedIntentCondition, IntentCounter) returns (uint256) {
        return IntentCounter._ruleId(p);
    }

    function action(bytes calldata p, address a) internal override(RuleContract, IntentCounter) {
        IntentCounter.action(p, a);
    }
}

contract XmssIntentCounter is IntentCounter, XmssIntentCondition {
    constructor(bytes32 root, bytes32 seed, uint256 firstEpoch, uint256 height, uint256 chainId, uint256 ruleId) XmssIntentCondition(root, seed, firstEpoch, height, chainId, ruleId) {}

    function _checkIntent(uint256 r, uint256 e, bytes calldata a, bytes calldata w) internal view override(SignedIntentCondition, XmssIntentCondition) returns (bool) {
        return XmssIntentCondition._checkIntent(r, e, a, w);
    }

    function _ruleId(bytes calldata p) internal pure override(SignedIntentCondition, IntentCounter) returns (uint256) {
        return IntentCounter._ruleId(p);
    }

    function action(bytes calldata p, address a) internal override(RuleContract, IntentCounter) {
        IntentCounter.action(p, a);
    }
}
