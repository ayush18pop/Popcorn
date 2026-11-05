// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EcdsaLib
/// @notice secp256k1 signature check through the ecrecover precompile, with the same rules as Core's owner path
///         (core/LAYOUT.md 0x6a): 65-byte r ++ s ++ v, v in {27, 28}, s <= n/2 (one encoding per signature).
library EcdsaLib {
    uint256 internal constant N_HALF = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;
    uint256 internal constant SIG_LENGTH = 65;

    /// @return true iff `sig` is a canonical signature of `digest` by `signer` (never address(0)).
    function verify(address signer, bytes32 digest, bytes calldata sig) internal view returns (bool) {
        if (signer == address(0) || sig.length != SIG_LENGTH) return false;
        uint256 s = uint256(bytes32(sig[32:64]));
        uint8 v = uint8(sig[64]);
        if ((v != 27 && v != 28) || s > N_HALF) return false;
        address rec;
        assembly ("memory-safe") {
            let m := mload(0x40)
            mstore(m, digest)
            mstore(add(m, 0x20), v)
            calldatacopy(add(m, 0x40), sig.offset, 32) // r
            mstore(add(m, 0x60), s)
            mstore(add(m, 0x80), 0)
            // ecrecover costs 3,000: forward a little more, never all gas
            if staticcall(5000, 1, m, 0x80, add(m, 0x80), 0x20) { rec := mload(add(m, 0x80)) }
        }
        return rec == signer;
    }
}
