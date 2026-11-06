// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoseidon2} from "src/privacy/IPoseidon.sol";
import {PoseidonZeros} from "src/privacy/PoseidonZeros.sol";

/// @title PoseidonTree
/// @notice An append-only depth-20 Poseidon Merkle tree kept in the rule contract's own storage (ERC-7201 namespace), with
///         every root it has ever had marked as known. Validation checks a proof's root with ONE read of this contract's
///         own storage, which needs no stake, so a pool never relies on recent-root references (Core rejects them, 0x23).
///         Old roots stay valid: leaves are only ever added, so a proof against an older root is still a true statement.
///         Inserting costs about 20 Poseidon calls; it runs in ordinary transactions (deposits), never in validation.
abstract contract PoseidonTree {
    /// @dev keccak256("popcorn.poseidonTree"): +0 next leaf index, +1 current root, filledSubtrees at +2..+21,
    ///      knownRoot(root) at keccak256(root, BASE).
    bytes32 private constant TREE = 0xe8fc9ef641d49bfd66bc3f41aa2ebd97f188b1e569ace19ffcb42296d2c3060e;

    IPoseidon2 public immutable poseidon;

    error TreeFull();
    error ZeroPoseidon();

    constructor(IPoseidon2 poseidon_) {
        if (address(poseidon_) == address(0)) revert ZeroPoseidon();
        poseidon = poseidon_;
    }

    function _treeSlot(uint256 i) private pure returns (bytes32 s) {
        return bytes32(uint256(TREE) + i);
    }

    function _knownSlot(uint256 root) private pure returns (bytes32 s) {
        return keccak256(abi.encode(root, TREE));
    }

    function _read(bytes32 s) private view returns (uint256 v) {
        assembly ("memory-safe") {
            v := sload(s)
        }
    }

    function _write(bytes32 s, uint256 v) private {
        assembly ("memory-safe") {
            sstore(s, v)
        }
    }

    /// @notice Number of leaves inserted so far.
    function _leafCount() internal view returns (uint256) {
        return _read(_treeSlot(0));
    }

    /// @notice The current root (the empty tree's root before the first insert).
    function _currentRoot() internal view returns (uint256 r) {
        r = _read(_treeSlot(1));
        if (r == 0) r = PoseidonZeros.zeros(PoseidonZeros.DEPTH);
    }

    /// @notice True if `root` is the empty root or any root this tree has had. One own-storage read.
    function _isKnownRoot(uint256 root) internal view returns (bool) {
        return root == PoseidonZeros.zeros(PoseidonZeros.DEPTH) || _read(_knownSlot(root)) == 1;
    }

    /// @notice Appends `leaf` and returns its index and the new root.
    function _insert(uint256 leaf) internal returns (uint256 index, uint256 root) {
        index = _leafCount();
        if (index >= (1 << PoseidonZeros.DEPTH)) revert TreeFull();
        uint256 node = leaf;
        uint256 i = index;
        for (uint256 lvl = 0; lvl < PoseidonZeros.DEPTH; lvl++) {
            if (i & 1 == 0) {
                _write(_treeSlot(2 + lvl), node);
                node = poseidon.poseidon([node, PoseidonZeros.zeros(lvl)]);
            } else {
                node = poseidon.poseidon([_read(_treeSlot(2 + lvl)), node]);
            }
            i >>= 1;
        }
        root = node;
        _write(_treeSlot(0), index + 1);
        _write(_treeSlot(1), root);
        _write(_knownSlot(root), 1);
    }
}
