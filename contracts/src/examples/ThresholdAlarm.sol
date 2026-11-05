// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ThresholdCondition} from "src/conditions/ThresholdCondition.sol";
import {RulePays} from "src/payers/RulePays.sol";

/// @title ThresholdAlarm (example rule contract logic)
/// @notice Triggers once, ever, when target.selector() crosses the line: records the value it saw and who paid.
///         nonceKey = keccak256("popcorn.example.threshold.fire") (a constant: Core's nonce_seq == 0 rule makes it once).
///         Optional self-stake (stakeAmount > 0): trigger with popArgs = STAKE_POP_ARGS first (RuleStake).
contract ThresholdAlarm is ThresholdCondition, RulePays {
    /// @dev keccak256("popcorn.example.threshold.fired"): the value seen by the action (0 = not fired).
    bytes32 public constant FIRED_SLOT = 0x94525a30f02a6813bbc9a8df69c8b6a92033521e917999e461e36736d6bdf664;
    uint256 public immutable stakeAmount;

    event Fired(uint256 value, address payer);

    constructor(address target, bytes4 selector, uint256 line, Direction direction, uint256 stakeAmount_)
        ThresholdCondition(target, selector, line, direction, 10_000)
    {
        stakeAmount = stakeAmount_;
    }

    function nonceKey() internal pure override returns (uint256) {
        return uint256(keccak256("popcorn.example.threshold.fire"));
    }

    function action(bytes calldata, address payer_) internal override {
        (, uint256 v) = _readThreshold();
        _sstore(FIRED_SLOT, v);
        emit Fired(v, payer_);
    }

    function _stakeConfig() internal view virtual override returns (address, uint256, uint32) {
        return (DEVNET_STAKING_REGISTRY, stakeAmount, 86_400);
    }
}
