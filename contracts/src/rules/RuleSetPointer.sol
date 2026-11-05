// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice How a config becomes the code of a data contract ("pointer") and how the shared logic recognises a pointer made by
///         the RuleSetPublisher (which validates before it deploys).
library RuleSetPointer {
    /// @dev loader: PUSH2 len, DUP1, PUSH1 12, PUSH1 0, CODECOPY, PUSH1 0, RETURN (12 bytes), then the config.
    function initcode(bytes memory config) internal pure returns (bytes memory) {
        return abi.encodePacked(hex"61", uint16(config.length), hex"80600c6000396000f3", config);
    }

    /// @dev CREATE2 address of the pointer `publisher` deploys for `config`: salt = keccak256(config).
    function expected(address publisher, bytes memory config) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), publisher, keccak256(config), keccak256(initcode(config)))))));
    }
}
