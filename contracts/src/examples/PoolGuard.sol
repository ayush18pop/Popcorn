// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleSetContract} from "src/rules/RuleSetContract.sol";
import "src/rules/RuleSetCodec.sol";

/// @title PoolGuard (example: a rule set written in Solidity, with a Solidity action)
/// @notice Two else-ordered rules over a pool contract: rule 0 fires when `pool.paused()` is true, otherwise rule 1 fires when
///         `pool.value()` fell below `floor`. The config is built with RuleSetCodec in the constructor (validated there); the
///         action is overridden to record which rule fired. Same engine as the data-driven RuleSetContract.
contract PoolGuard is RuleSetContract {
    /// @dev keccak256("popcorn.example.poolguard.last"): the last rule that fired, plus one (0 = none yet)
    bytes32 public constant LAST_RULE_SLOT = keccak256("popcorn.example.poolguard.last");

    constructor(address pool, uint256 floor) RuleSetContract(_rules(pool, floor), 0) {}

    function _rules(address pool, uint256 floor) private pure returns (bytes memory) {
        RuleSetCodec.Rule[] memory r = new RuleSetCodec.Rule[](2);
        r[0] = RuleSetCodec.rule(RuleSetCodec.cmp(RuleSetCodec.srcGetter(pool, bytes4(keccak256("paused()")), 20_000), OP_EQ, 1), 1, ACTION_NONE, "", 0);
        r[1] = RuleSetCodec.rule(RuleSetCodec.cmp(RuleSetCodec.srcGetter(pool, bytes4(keccak256("value()")), 20_000), OP_LT, floor), 1, ACTION_NONE, "", 0);
        return RuleSetCodec.encode(1, r);
    }

    /// @dev One storage write, no external call: it cannot fail for a reason a triggerer or payer controls. The write
    ///      uses a FRESH slot the first time (97,920 state gas) on top of the rule's own epoch slot, so deploy the rule contract with
    ///      maxStateGasPerFrame >= 2 * 97,920 (the SDK default); the planner cannot see slots an override writes.
    function _runAction(uint256 ruleId, uint256, bytes calldata, address, bytes memory) internal override returns (bool) {
        _sstore(LAST_RULE_SLOT, ruleId + 1);
        return true;
    }
}
