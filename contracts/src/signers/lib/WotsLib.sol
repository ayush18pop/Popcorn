// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WotsLib
/// @notice WOTS+ (w = 16, n = 32, keccak256, 67 chains) with a height-10 Merkle tree of one-time keys: the same scheme as
///         Popcorn Core's owner path (core/PopcornCore.yul wotsVerify) and the SDK's WOTS+ signer, ported to assembly with
///         the same inner loop (about 111 gas per hash step, 506 steps on average).
///
///           chain step  F(T, x) = keccak256(T ++ x),   T = pubSeed XOR (leaf << 16 | chain << 8 | step)
///           leaf hash   keccak256(chain ends 0..66)    node = keccak256(left ++ right)
///           signature   67 chain values ++ 10 Merkle path nodes = 2,464 bytes
///
///         The message is any 32-byte value (for signed intents: keccak256(intent digest ++ salt)). A leaf signs ONE message: the
///         predicates fix leaf = ruleEpoch - firstEpoch, and the SDK signer refuses to sign a second digest for a leaf.
library WotsLib {
    uint256 internal constant HEIGHT = 10;
    uint256 internal constant LEAVES = 1 << 10;
    uint256 internal constant SIG_BYTES = 2464; // 32 * (67 + 10)

    function verify(bytes32 root, bytes32 seed, uint256 leaf, bytes32 msg_, bytes calldata sig) internal pure returns (bool ok) {
        if (sig.length != SIG_BYTES || leaf >= LEAVES) return false;
        assembly ("memory-safe") {
            let buf := mload(0x40)
            calldatacopy(buf, sig.offset, SIG_BYTES)
            let base0 := xor(seed, shl(16, leaf))
            let csum := 0
            for { let i := 0 } lt(i, 64) { i := add(i, 1) } {
                let d := and(shr(sub(256, mul(4, add(i, 1))), msg_), 15)
                csum := add(csum, sub(15, d))
                let ptr := add(buf, shl(5, i))
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
                let ptr := add(buf, shl(5, i))
                let base := xor(base0, shl(8, i))
                mstore(0x20, mload(ptr))
                for { let st := d } lt(st, 15) { st := add(st, 1) } {
                    mstore(0, xor(base, st))
                    mstore(0x20, keccak256(0, 0x40))
                }
                mstore(ptr, mload(0x20))
            }
            let node := keccak256(buf, 2144)
            let path := add(buf, 2144)
            for { let k := 0 } lt(k, 10) { k := add(k, 1) } {
                let sib := mload(add(path, shl(5, k)))
                switch and(shr(k, leaf), 1)
                case 0 {
                    mstore(0, node)
                    mstore(0x20, sib)
                }
                default {
                    mstore(0, sib)
                    mstore(0x20, node)
                }
                node := keccak256(0, 0x40)
            }
            ok := eq(node, root)
        }
    }
}
