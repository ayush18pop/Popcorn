// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";

/// @title ThresholdCondition
/// @notice condition() = a uint256 read from `target` (STATICCALL of `selector` with no arguments) is strictly beyond
///         `line`: Direction.Above -> value > line, Direction.Below -> value < line. A failed call, a short return,
///         or a revert make the condition false (fail closed). The developer still implements nonceKey() and action().
///
///         Mempool: the read touches ANOTHER contract's storage, which the sidecar allows only for a STAKED rule contract
///         (`unstaked sender accessed <target> slot <s>`) and which ethrex flags as non-canonical
///         (StorageReadNonSender) whatever the stake.
///         `readGas` bounds the STATICCALL so a misbehaving target cannot eat the condition budget.
abstract contract ThresholdCondition is RuleContract {
    enum Direction {
        Above,
        Below
    }

    address public immutable thresholdTarget;
    bytes4 public immutable thresholdSelector;
    uint256 public immutable thresholdLine;
    Direction public immutable thresholdDirection;
    uint256 public immutable thresholdReadGas;

    error ZeroTarget();

    constructor(address target, bytes4 selector, uint256 line, Direction direction, uint256 readGas) {
        if (target == address(0)) revert ZeroTarget();
        thresholdTarget = target;
        thresholdSelector = selector;
        thresholdLine = line;
        thresholdDirection = direction;
        thresholdReadGas = readGas;
    }

    /// @notice (ok, value): ok is false when the read failed. Override to read the value elsewhere, e.g. from the
    ///         rule contract's own storage, which needs no stake and is canonical on ethrex (see SelfThresholdRule contract).
    function _readThreshold() internal view virtual returns (bool ok, uint256 value) {
        (bool s, bytes memory ret) = thresholdTarget.staticcall{gas: thresholdReadGas}(abi.encodeWithSelector(thresholdSelector));
        if (!s || ret.length != 32) return (false, 0);
        return (true, abi.decode(ret, (uint256)));
    }

    /// @notice Pure comparison, exposed for tests and simulate().
    function thresholdCrossed(uint256 value) public view returns (bool) {
        return thresholdDirection == Direction.Above ? value > thresholdLine : value < thresholdLine;
    }

    function condition() internal view virtual override returns (bool) {
        (bool ok, uint256 v) = _readThreshold();
        return ok && thresholdCrossed(v);
    }
}
