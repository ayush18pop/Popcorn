// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleSet} from "src/rules/RuleSet.sol";
import {RulePays} from "src/payers/RulePays.sol";
import {RuleSetPointer} from "src/rules/RuleSetPointer.sol";

/// @title RuleSetLogic
/// @notice The SHARED data-driven rule-set logic (rule-pays): one deployment serves any number of rule contracts. A rule contract's rule
///         set is a config published through the RuleSetPublisher (validated there), and the rule contract names it in the
///         `verifier` field of its Core args (a field Core.x ignores; the factory only checks it has code). The logic
///         reads that field from the RULE CONTRACT's own code (address(this) is the rule contract under DELEGATECALL: the 101 args are the
///         last bytes of its code, `verifier` is bytes [length-32, length-12)), copies the pointer's code (the config) with one
///         EXTCODECOPY, and checks keccak/CREATE2 that the pointer is the publisher's deployment of exactly those bytes.
///
///         Why this and not a logic per config (RuleSetContract): a new rule-set rule contract then costs one small data contract and
///         one factory.create instead of a 17 KB logic deployment (about 26M gas of code deposit on this devnet). Mempool
///         class is the same: code reads (EXTCODESIZE/EXTCODECOPY of the rule contract itself and of the pointer) touch no storage.
///         Immutable: the rule contract's args are code, and a pointer's code cannot change.
///
///         Stake: `stakeAmount_` > 0 enables the built-in stake trigger for rule contracts on THIS logic deployment (deploy one logic per
///         stake amount; the SDK's ensureRuleSetInfrastructure does).
contract RuleSetLogic is RuleSet, RulePays {
    address public immutable publisher;
    uint256 public immutable stakeAmount;

    error NotARule();
    error BadPointer(address pointer);

    constructor(address publisher_, uint256 stakeAmount_) {
        publisher = publisher_;
        stakeAmount = stakeAmount_;
    }

    /// @dev The `verifier` arg of the rule contract running this logic. Overridden in tests (the harness is not a Core rule contract).
    function _verifierArg() internal view virtual returns (address ptr) {
        uint256 n = address(this).code.length;
        if (n < 101) revert NotARule();
        assembly ("memory-safe") {
            let m := mload(0x40)
            extcodecopy(address(), m, sub(n, 32), 32) // bytes [n-32, n): verifier (20) ++ conditionGas, data caps (12)
            ptr := shr(96, mload(m))
        }
    }

    function _ruleSetConfig() internal view override returns (bytes memory out) {
        address ptr = _verifierArg();
        uint256 len = ptr.code.length;
        out = new bytes(len);
        assembly ("memory-safe") {
            extcodecopy(ptr, add(out, 32), 0, len)
        }
        if (len == 0 || RuleSetPointer.expected(publisher, out) != ptr) revert BadPointer(ptr);
    }

    /// @notice The config a rule contract on this logic runs (forwarded: call it on the rule contract).
    function ruleSetConfig() external view forwarded returns (bytes memory) {
        return _ruleSetConfig();
    }

    function _stakeConfig() internal view virtual override returns (address, uint256, uint32) {
        return (DEVNET_STAKING_REGISTRY, stakeAmount, 86_400);
    }
}
