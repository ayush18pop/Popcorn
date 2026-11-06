// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Sending ETH or an ERC-20 from an action that must not revert because of the receiver or the token.
library TokenOut {
    /// @notice Sends `amount` of `token` (address(0) = ETH) to `to` with `g` gas. True only when it arrived: ETH by a
    ///         successful CALL; an ERC-20 transfer that succeeded and returned nothing (from a contract) or one word == 1.
    ///         At most 32 bytes of return data are copied, so a hostile token cannot make the caller pay for a huge copy.
    function send(address token, address to, uint256 amount, uint256 g) internal returns (bool ok) {
        if (token == address(0)) {
            assembly ("memory-safe") {
                ok := call(g, to, amount, 0, 0, 0, 0)
            }
            return ok;
        }
        bytes memory data = abi.encodeWithSelector(0xa9059cbb, to, amount); // transfer(address,uint256)
        uint256 rs;
        uint256 word;
        assembly ("memory-safe") {
            ok := call(g, token, 0, add(data, 0x20), mload(data), 0, 0x20)
            rs := returndatasize()
            word := mload(0)
        }
        ok = ok && (rs == 0 ? token.code.length > 0 : (rs >= 32 && word == 1));
    }

    /// @notice Pulls `amount` of an ERC-20 from `from` (an ordinary call: reverting is fine there).
    function pull(address token, address from, uint256 amount) internal returns (bool ok) {
        bytes memory data = abi.encodeWithSelector(0x23b872dd, from, address(this), amount); // transferFrom
        uint256 rs;
        uint256 word;
        assembly ("memory-safe") {
            ok := call(gas(), token, 0, add(data, 0x20), mload(data), 0, 0x20)
            rs := returndatasize()
            word := mload(0)
        }
        ok = ok && (rs == 0 ? token.code.length > 0 : (rs >= 32 && word == 1));
    }
}
