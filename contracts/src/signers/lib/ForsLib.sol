// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ForsLib
/// @notice FORS few-time signature (the building block of SPHINCS+), keccak256, n = 32, k = 24 trees of height a = 8.
///         OUR OWN construction in the style of SPHINCS+ FORS (not the SPHINCS+ spec's hashing or encodings, no KATs).
///
///           key        pk (32) and pubSeed (32) are public; the 24 x 256 secret leaves are keccak256(skSeed ++ tree ++ leaf)
///           tweak      T(t, level, node) = pubSeed XOR (t << 48 | level << 40 | node)
///           leaf       keccak256(T(t, 0, i) ++ sk)               node = keccak256(T(t, l, j) ++ left ++ right)
///           pk         keccak256(pubSeed XOR (1 << 200) ++ root_0 ++ ... ++ root_23)
///           indices    md = keccak256(pubSeed ++ salt ++ message); tree t opens leaf byte t of md (a = 8 -> one byte each)
///           signature  salt (32) ++ 24 x ( secret leaf (32) ++ 8 authentication nodes (256) ) = 6,944 bytes
///
///         Each signature reveals one leaf per tree. After r signatures an attacker who sees them forges a NEW message with
///         probability about (r / 256)^24 = 2^-(24 * (8 - log2 r)): 2^-192 (r = 1), 2^-120 (r = 8), 2^-72 (r = 32). The
///         predicate therefore accepts at most MAX_SIGNATURES = 8 epochs per key and the SDK refuses a ninth. This is an
///         estimate of the FORS term only (not a reviewed security level; keccak256 preimage/collision margins are on top).
library ForsLib {
    uint256 internal constant K = 24;
    uint256 internal constant A = 8;
    uint256 internal constant MAX_SIGNATURES = 8;
    uint256 internal constant TREE_BYTES = 32 * (1 + A); // 288
    uint256 internal constant SIG_BYTES = 32 + K * TREE_BYTES; // 6,944

    function verify(bytes32 pk, bytes32 seed, bytes32 message, bytes calldata sig) internal pure returns (bool ok) {
        if (sig.length != SIG_BYTES) return false;
        assembly ("memory-safe") {
            let buf := mload(0x40)
            // md = keccak256(seed ++ salt ++ message)
            mstore(buf, seed)
            calldatacopy(add(buf, 0x20), sig.offset, 32)
            mstore(add(buf, 0x40), message)
            let md := keccak256(buf, 0x60)
            let roots := add(buf, 0x80) // 32 bytes of tweak before the roots: keccak256(roots - 32, 32 + 24 * 32)
            for { let t := 0 } lt(t, 24) { t := add(t, 1) } {
                let idx := byte(t, md)
                let off := add(sig.offset, add(32, mul(t, 288)))
                let tb := shl(48, t)
                // leaf = keccak256(T(t, 0, idx) ++ sk)
                mstore(buf, xor(seed, or(tb, idx)))
                calldatacopy(add(buf, 0x20), off, 32)
                let node := keccak256(buf, 0x40)
                for { let l := 0 } lt(l, 8) { l := add(l, 1) } {
                    let sib := calldataload(add(off, add(32, shl(5, l))))
                    mstore(buf, xor(seed, or(or(tb, shl(40, add(l, 1))), shr(add(l, 1), idx))))
                    switch and(shr(l, idx), 1)
                    case 0 {
                        mstore(add(buf, 0x20), node)
                        mstore(add(buf, 0x40), sib)
                    }
                    default {
                        mstore(add(buf, 0x20), sib)
                        mstore(add(buf, 0x40), node)
                    }
                    node := keccak256(buf, 0x60)
                }
                mstore(add(roots, shl(5, t)), node)
            }
            mstore(sub(roots, 0x20), xor(seed, shl(200, 1)))
            ok := eq(keccak256(sub(roots, 0x20), 800), pk)
        }
    }
}
