// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleSet} from "src/rules/RuleSet.sol";
import {RulePays} from "src/payers/RulePays.sol";
import {RuleSetCodec} from "src/rules/RuleSetCodec.sol";

/// @title RuleSetContract
/// @notice The data-driven rule-set logic (rule-pays). Deploy it with a config (RuleSetCodec / the SDK's encodeRuleSet)
///         and point a rule contract at it: no Solidity to compile for a new rule set.
///
///         Where the config lives: the constructor validates it, then writes it as the CODE of a tiny data
///         contract (the first 12 bytes are a loader, the rest is the config). Every VERIFY reads it with one EXTCODECOPY
///         (a code read, not a storage read: no state, no cold-slot cost per byte, no foreign storage, nothing in the rule contract's
///         own storage that a forwarded call could overwrite, and it is immutable by construction). The logic keeps only the
///         data contract's address and the config length as immutables.
///
///         Stake: `stakeAmount_` > 0 enables the built-in stake trigger (RuleStake) so a rule contract with foreign-storage leaves
///         can stake itself (SDK deployRule contract({ stake: true })).
contract RuleSetContract is RuleSet, RulePays {
    address public immutable configPointer;
    uint256 public immutable configLength;
    uint256 public immutable stakeAmount;

    error DeployFailed();

    constructor(bytes memory config, uint256 stakeAmount_) {
        RuleSetCodec.validate(config);
        uint256 len = config.length;
        // loader: PUSH2 len DUP1 PUSH1 12 PUSH1 0 CODECOPY PUSH1 0 RETURN, then the config
        bytes memory init = abi.encodePacked(hex"61", uint16(len), hex"80600c6000396000f3", config);
        address ptr;
        assembly ("memory-safe") {
            ptr := create(0, add(init, 32), mload(init))
        }
        if (ptr == address(0)) revert DeployFailed();
        configPointer = ptr;
        configLength = len;
        stakeAmount = stakeAmount_;
    }

    function _ruleSetConfig() internal view override returns (bytes memory out) {
        address ptr = configPointer;
        uint256 len = configLength;
        out = new bytes(len);
        assembly ("memory-safe") {
            extcodecopy(ptr, add(out, 32), 0, len)
        }
    }

    /// @notice The config this logic (or a rule contract using it) runs. Works on the logic and, forwarded, on a rule contract.
    function ruleSetConfig() external view returns (bytes memory) {
        return _ruleSetConfig();
    }

    function _stakeConfig() internal view virtual override returns (address, uint256, uint32) {
        return (DEVNET_STAKING_REGISTRY, stakeAmount, 86_400);
    }
}
