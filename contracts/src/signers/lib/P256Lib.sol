// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title P256Lib
/// @notice NIST P-256 signature check through the P256VERIFY precompile (EIP-7951, address 0x100, 6,900 gas).
///         The precompile accepts both s and n - s (measured on the local ethrex: a high-s twin verifies), so low-s is
///         enforced here: one encoding per signature. A chain without the precompile returns empty data -> false.
library P256Lib {
    address internal constant PRECOMPILE = address(0x100);
    uint256 internal constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 internal constant N_HALF = 0x7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCF4279DCE5617E3192A8;
    /// @dev EIP-7951 price is 6,900; the cap leaves room for a repricing but bounds a misbehaving address.
    uint256 internal constant FORWARD_GAS = 10_000;

    /// @param hash the 32-byte message hash the key signed (the digest itself, or sha256 of the WebAuthn blob)
    function verify(bytes32 hash, uint256 r, uint256 s, uint256 x, uint256 y) internal view returns (bool ok) {
        if (r == 0 || r >= N || s == 0 || s > N_HALF) return false;
        assembly ("memory-safe") {
            let m := mload(0x40)
            mstore(m, hash)
            mstore(add(m, 0x20), r)
            mstore(add(m, 0x40), s)
            mstore(add(m, 0x60), x)
            mstore(add(m, 0x80), y)
            mstore(add(m, 0xa0), 0)
            let called := staticcall(FORWARD_GAS, 0x100, m, 0xa0, add(m, 0xa0), 0x20)
            ok := and(called, and(eq(returndatasize(), 0x20), eq(mload(add(m, 0xa0)), 1)))
        }
    }
}
