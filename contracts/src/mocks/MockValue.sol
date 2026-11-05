// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice A value anyone can set with a normal tx (ThresholdCondition target in tests).
contract MockValue {
    uint256 public value;

    function set(uint256 v) external {
        value = v;
    }
}
