// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SphincsLib
/// @notice SPHINCS+-style STATELESS hash-based signature, keccak256 truncated to n = 16 bytes. OUR OWN construction, written from the
///         public SPHINCS+ design (FORS + hypertree of WOTS+ trees): it is NOT the NIST SLH-DSA / SPHINCS+ standard encoding and has no
///         KATs from either; vectors are self-generated. No code of JARDIN or SPHINCS- is used (neither has a licence we can take
///         code under); their parameter choices (n = 16, w = 16, keccak) were read as reference only.
///
///         PARAMETER SET "popcorn-sphincs-keccak-16-h20" (chosen to fit the 8,192-byte verifyData cap and a 250k VERIFY budget):
///           n = 16, w = 16 (35 chains: 32 message digits + 3 checksum digits), d = 2 layers of height 10 (h = 20: 2^20 signatures per key),
///           FORS k = 26 trees of height a = 8.  Signature = 16 + 26 * 9 * 16 + 2 * (35 + 10) * 16 = 5,200 bytes.
///           Security (ESTIMATE, not a reviewed level): a FORS instance reveals one leaf per tree per use; after r uses the forgery
///           chance for a new message is about 2^-(26 * (8 - log2 r)): 2^-130 at r = 8, which is the tail of the Poisson(1) use count
///           over 2^20 instances. Beyond 2^20 signatures the margin shrinks gradually; do not sign more than 2^20 times with one key.
///
///         HASHES (all truncated to the first 16 bytes of keccak256; a 16-byte value is left-aligned in its 32-byte word)
///           T(addr)     = pubSeed XOR ADDR, ADDR = type << 144 | layer << 136 | tree << 72 | keypair << 40 | height << 32 | index
///           F(T, x)     = keccak256(T ++ x ++ 0^16)                     chain steps, FORS leaves
///           H(T, l, r)  = keccak256(T ++ l ++ r)                         tree nodes
///           C(T, xs)    = keccak256(T ++ x_0 ++ ... )                    WOTS public key (35 values), FORS roots (26 values)
///           types       0 WOTS chain step (height = chain, index = step)  1 WOTS public key  2 hypertree node (height, index)
///                       3 FORS node (height, index = t << 8 | node)       4 FORS roots (layer 0xff for 3 and 4)
///           message     md = keccak256(R ++ pubSeed ++ root ++ digest) (16 + 32 + 16 + 32 bytes); FORS leaf of tree t = md byte t (t < 26);
///                       hypertree leaf index idx = low 20 bits of the 24-bit value in md bytes 26..28
///                       layer l: tree = idx >> (10 (l + 1)), leaf = (idx >> 10 l) & 1023; the FORS instance sits at (tree, leaf) of layer 0
///           signature   R (16) ++ 26 x (secret leaf ++ 8 auth nodes) ++ 2 x (35 chain values ++ 10 auth nodes)
///           key         pubSeed (32 bytes), root (16 bytes, left-aligned)
library SphincsLib {
    uint256 internal constant SIG_BYTES = 5200;

    bytes32 private constant HI = 0xffffffffffffffffffffffffffffffff00000000000000000000000000000000;
    bytes32 private constant LO = 0x00000000000000000000000000000000ffffffffffffffffffffffffffffffff;

    function verify(bytes32 pubSeed, bytes32 root, bytes32 digest, bytes calldata sig) internal pure returns (bool) {
        if (sig.length != SIG_BYTES || uint128(uint256(root)) != 0) return false;
        bytes32 md;
        assembly ("memory-safe") {
            // md = keccak256(R ++ pubSeed ++ root ++ digest): R is 16 bytes at offset 0, pubSeed at 16, root at 48, digest at 64
            let buf := mload(0x40)
            mstore(buf, and(calldataload(sig.offset), HI))
            mstore(add(buf, 16), pubSeed)
            mstore(add(buf, 48), root)
            mstore(add(buf, 64), digest)
            md := keccak256(buf, 96)
        }
        bytes32 forsPk = _fors(pubSeed, md, sig);
        return _hypertree(pubSeed, md, forsPk, sig) == root;
    }

    /// @dev FORS: 26 trees of height 8 -> the 26 roots, compressed.
    function _fors(bytes32 pubSeed, bytes32 md, bytes calldata sig) private pure returns (bytes32 out) {
        assembly ("memory-safe") {
            let idx := and(shr(24, md), 0xfffff)
            let fr := add(mload(0x40), 128) // the 26 roots, packed after a 32-byte tweak
            let fb := xor(pubSeed, or(or(shl(144, 3), shl(136, 0xff)), or(shl(72, shr(10, idx)), shl(40, and(idx, 1023)))))
            for { let t := 0 } lt(t, 26) { t := add(t, 1) } {
                let i := byte(t, md)
                let off := add(sig.offset, add(16, mul(t, 144)))
                let tb := shl(8, t)
                mstore(0, xor(fb, or(tb, i)))
                mstore(0x20, and(calldataload(off), HI))
                let node := and(keccak256(0, 0x40), HI)
                for { let h := 0 } lt(h, 8) { h := add(h, 1) } {
                    let sib := and(calldataload(add(off, add(16, shl(4, h)))), HI)
                    mstore(0, xor(fb, or(shl(32, add(h, 1)), or(tb, shr(add(h, 1), i)))))
                    switch and(shr(h, i), 1)
                    case 0 { mstore(0x20, or(node, shr(128, sib))) }
                    default { mstore(0x20, or(sib, shr(128, node))) }
                    node := and(keccak256(0, 0x40), HI)
                }
                mstore(add(fr, add(32, shl(4, t))), node)
            }
            mstore(fr, xor(pubSeed, or(or(shl(144, 4), shl(136, 0xff)), or(shl(72, shr(10, idx)), shl(40, and(idx, 1023))))))
            out := and(keccak256(fr, 448), HI) // 32 + 26 * 16
        }
    }

    /// @dev Hypertree: 2 layers of WOTS+ (35 chains) + a height-10 authentication path each; returns the top root.
    function _hypertree(bytes32 pubSeed, bytes32 md, bytes32 msg_, bytes calldata sig) private pure returns (bytes32) {
        assembly ("memory-safe") {
            let idx := and(shr(24, md), 0xfffff)
            let lo := add(sig.offset, 3760) // 16 + 26 * 144
            let w := add(mload(0x40), 128) // a 32-byte tweak slot, then the 35 chain values
            for { let l := 0 } lt(l, 2) { l := add(l, 1) } {
                let tree := shr(mul(10, add(l, 1)), idx)
                let leaf := and(shr(mul(10, l), idx), 1023)
                calldatacopy(add(w, 32), lo, 560)
                let base0 := xor(pubSeed, or(shl(136, l), or(shl(72, tree), shl(40, leaf)))) // address type 0
                let csum := 0
                for { let i := 0 } lt(i, 35) { i := add(i, 1) } {
                    let d
                    switch lt(i, 32)
                    case 1 {
                        d := and(shr(sub(252, shl(2, i)), msg_), 15)
                        csum := add(csum, sub(15, d))
                    }
                    default { d := and(shr(shl(2, sub(34, i)), csum), 15) }
                    let ptr := add(w, add(32, shl(4, i)))
                    let x := and(mload(ptr), HI)
                    let base := xor(base0, shl(32, i))
                    for { let st := d } lt(st, 15) { st := add(st, 1) } {
                        mstore(0, xor(base, st))
                        mstore(0x20, x)
                        x := and(keccak256(0, 0x40), HI)
                    }
                    mstore(ptr, or(x, and(mload(ptr), LO)))
                }
                // WOTS public key = the leaf of this layer's tree
                mstore(w, xor(pubSeed, or(or(shl(144, 1), shl(136, l)), or(shl(72, tree), shl(40, leaf)))))
                msg_ := and(keccak256(w, 592), HI) // 32 + 35 * 16
                let tb := xor(pubSeed, or(or(shl(144, 2), shl(136, l)), shl(72, tree)))
                for { let h := 0 } lt(h, 10) { h := add(h, 1) } {
                    let sib := and(calldataload(add(lo, add(560, shl(4, h)))), HI)
                    mstore(0, xor(tb, or(shl(32, add(h, 1)), shr(add(h, 1), leaf))))
                    switch and(shr(h, leaf), 1)
                    case 0 { mstore(0x20, or(msg_, shr(128, sib))) }
                    default { mstore(0x20, or(sib, shr(128, msg_))) }
                    msg_ := and(keccak256(0, 0x40), HI)
                }
                lo := add(lo, 720)
            }
        }
        return msg_;
    }
}
