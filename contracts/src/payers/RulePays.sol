// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleCosts} from "src/rules/RuleCosts.sol";

/// @title RulePays
/// @notice Marks a rule contract logic as rule-pays (Core mode 0, the only mode Core deploys): the rule contract's own balance
///         pays every trigger, so a 0-ETH account can trigger it, and `payer` in action() is the rule contract itself.
///         These views are for simulate()/the SDK and are called on the LOGIC contract directly (they are not reserved
///         entry points and read no rule contract state).
abstract contract RulePays {
    /// @notice Core `mode` this logic expects (0 = rule-pays).
    function popcornMode() external pure returns (uint8) {
        return 0;
    }

    /// @notice Worst-case wei one trigger can make the rule contract reserve, from the rule contract's Core args.
    function popcornMaxCostPerPop(
        uint256 maxFeePerGas,
        uint256 maxGasPerFrame,
        uint256 maxStateGasPerFrame,
        uint256 maxVerifyDataLength,
        uint256 maxTriggerDataLength
    ) external pure returns (uint256) {
        return RuleCosts.maxCostPerTrigger(maxFeePerGas, maxGasPerFrame, maxStateGasPerFrame, maxVerifyDataLength, maxTriggerDataLength);
    }

    /// @notice Balance the rule contract must keep for `triggers` more triggers at worst-case cost. The protocol
    ///         checks the full reservation for each trigger separately, so even one trigger needs maxCostPerTrigger.
    function popcornMinOperatingBalance(
        uint256 maxFeePerGas,
        uint256 maxGasPerFrame,
        uint256 maxStateGasPerFrame,
        uint256 maxVerifyDataLength,
        uint256 maxTriggerDataLength,
        uint256 pops
    ) external pure returns (uint256) {
        return (pops == 0 ? 1 : pops)
            * RuleCosts.maxCostPerTrigger(maxFeePerGas, maxGasPerFrame, maxStateGasPerFrame, maxVerifyDataLength, maxTriggerDataLength);
    }
}
