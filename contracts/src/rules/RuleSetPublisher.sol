// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleSetCodec} from "src/rules/RuleSetCodec.sol";
import {RuleSetPointer} from "src/rules/RuleSetPointer.sol";

/// @title RuleSetPublisher
/// @notice Validates a rule-set config (every bound of RuleSetCodec.validate: rules, nodes, depth, children, leaf fields,
///         predicate polarity, size) and stores it as the code of a data contract at a deterministic CREATE2 address
///         (salt = keccak256(config)). A rule contract running the shared RuleSetLogic keeps that address in its `verifier` arg;
///         the logic recomputes the address from the config it reads, so a rule contract can only ever run a config this contract
///         accepted. Publishing is permissionless and idempotent: the same bytes always map to the same pointer.
contract RuleSetPublisher {
    event Published(address indexed pointer, bytes32 indexed configHash, uint256 size);

    error DeployFailed();

    function publish(bytes calldata config) external returns (address ptr) {
        bytes memory c = config;
        RuleSetCodec.validate(c);
        ptr = RuleSetPointer.expected(address(this), c);
        if (ptr.code.length == 0) {
            bytes memory init = RuleSetPointer.initcode(c);
            bytes32 salt = keccak256(c);
            address made;
            assembly ("memory-safe") {
                made := create2(0, add(init, 32), mload(init), salt)
            }
            if (made != ptr) revert DeployFailed();
        }
        emit Published(ptr, keccak256(c), c.length);
    }

    /// @notice The pointer `publish(config)` creates or returns (does not validate or deploy).
    function predict(bytes calldata config) external view returns (address) {
        return RuleSetPointer.expected(address(this), config);
    }
}
