// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";

/// @title Make A Call (action block)
/// @notice Calls any contract with any data and value, from the build. Best effort: a call that fails is reported in an
///         event and the action carries on, because the trigger's key is already spent and a reverting action would lose
///         whatever the action was meant to move forward. Cap the gas when the callee is not trusted.
///
///         Uses: a wallet spend (with Signed Instruction), a swap out of a depegged asset, a withdrawal from a protocol
///         that was just upgraded, pausing an outside protocol that has its own pause function.
abstract contract MakeACall is RuleContract {
    event CallMade(address indexed to, uint256 value, bytes4 selector, bool ok);

    /// @notice Calls `to` with all remaining gas.
    function _makeCall(address to, uint256 value, bytes memory data) internal returns (bool ok) {
        return _makeCall(to, value, data, gasleft());
    }

    /// @notice Calls `to` with at most `gasCap` gas. Return data is not copied.
    function _makeCall(address to, uint256 value, bytes memory data, uint256 gasCap) internal returns (bool ok) {
        assembly ("memory-safe") {
            ok := call(gasCap, to, value, add(data, 0x20), mload(data), 0, 0)
        }
        emit CallMade(to, value, data.length >= 4 ? bytes4(data) : bytes4(0), ok);
    }
}
