// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title XmssLib
/// @notice Stateful hash-based signature in the XMSS / LMS style, keccak256, n = 32: a WOTS+ one-time key (w = 16, 67 chains) per
///         leaf of a Merkle tree of configurable height H (1..20). OUR OWN construction: it is NOT RFC 8391 (XMSS), NOT NIST SP
///         800-208 (LMS/HSS) and has no KATs from either; vectors are self-generated. What it takes from them: a per-address tweak on
///         every hash (chain steps AND tree nodes), a leaf index, domain-separated message randomisation.
///
///           tweak       chain step   T = I XOR (q << 16 | chain << 8 | step)            x' = keccak256(T ++ x)
///                       leaf         T = I XOR (1 << 200 | q)                            keccak256(T ++ y_0 ++ ... ++ y_66)
///                       tree node    T = I XOR (2 << 200 | level << 32 | index)          keccak256(T ++ left ++ right)
///                       (q = leaf index, level 1 = parents of leaves, index within the level)
///           message     m = keccak256((I XOR (3 << 200 | q)) ++ salt ++ digest): 64 base-16 digits + 3 checksum digits
///           signature   salt (32) ++ 67 chain values ++ H authentication nodes = 32 + 32 * (67 + H) bytes
///           key         root (32), I (32 bytes, the public seed), H
///
///         The leaf index q is the signing counter: the signer fixes q = ruleEpoch - firstEpoch (so a rule's epochs use the
///         leaves in order), and the SDK signer refuses to sign a second digest with a leaf. 2^H signatures per key.
library XmssLib {
    uint256 internal constant LEN = 67;
    uint256 internal constant MAX_HEIGHT = 20;

    function sigBytes(uint256 height) internal pure returns (uint256) {
        return 32 + 32 * (LEN + height);
    }

    function verify(bytes32 root, bytes32 seed, uint256 height, uint256 q, bytes32 digest, bytes calldata sig) internal pure returns (bool ok) {
        if (height == 0 || height > MAX_HEIGHT || q >= (1 << height) || sig.length != sigBytes(height)) return false;
        assembly ("memory-safe") {
            let buf := mload(0x40)
            // m = keccak256(T_msg ++ salt ++ digest)
            mstore(buf, xor(seed, or(shl(200, 3), q)))
            calldatacopy(add(buf, 0x20), sig.offset, 32)
            mstore(add(buf, 0x40), digest)
            let msg_ := keccak256(buf, 0x60)
            // the 67 chains, in place at `chains` (copied from calldata)
            let chains := add(buf, 0x80)
            calldatacopy(chains, add(sig.offset, 32), 2144)
            let base0 := xor(seed, shl(16, q))
            let csum := 0
            for { let i := 0 } lt(i, 64) { i := add(i, 1) } {
                let d := and(shr(sub(252, mul(4, i)), msg_), 15)
                csum := add(csum, sub(15, d))
                let ptr := add(chains, shl(5, i))
                let base := xor(base0, shl(8, i))
                mstore(0x20, mload(ptr))
                for { let st := d } lt(st, 15) { st := add(st, 1) } {
                    mstore(0, xor(base, st))
                    mstore(0x20, keccak256(0, 0x40))
                }
                mstore(ptr, mload(0x20))
            }
            for { let j := 0 } lt(j, 3) { j := add(j, 1) } {
                let d := and(shr(mul(4, sub(2, j)), csum), 15)
                let i := add(64, j)
                let ptr := add(chains, shl(5, i))
                let base := xor(base0, shl(8, i))
                mstore(0x20, mload(ptr))
                for { let st := d } lt(st, 15) { st := add(st, 1) } {
                    mstore(0, xor(base, st))
                    mstore(0x20, keccak256(0, 0x40))
                }
                mstore(ptr, mload(0x20))
            }
            // leaf = keccak256(T_leaf ++ chain ends): the tweak sits in the 32 bytes just before the chains
            mstore(add(chains, not(31)), xor(seed, or(shl(200, 1), q)))
            let node := keccak256(sub(chains, 0x20), 2176)
            // authentication path
            let path := add(sig.offset, 2176)
            for { let l := 0 } lt(l, height) { l := add(l, 1) } {
                let sib := calldataload(add(path, shl(5, l)))
                mstore(buf, xor(seed, or(shl(200, 2), or(shl(32, add(l, 1)), shr(add(l, 1), q)))))
                switch and(shr(l, q), 1)
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
            ok := eq(node, root)
        }
    }
}
