// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Calls a rule contract back from inside its __action (Core test: the forward path must refuse, 0x39).
contract Bouncer {
    /// @notice Calls `rule contract` with `data`; returns (ok, return or revert data).
    function bounce(address ruleContract, bytes calldata data) external returns (bool ok, bytes memory ret) {
        (ok, ret) = ruleContract.call(data);
    }
}
