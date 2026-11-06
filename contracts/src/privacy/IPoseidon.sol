// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice circomlib's Poseidon contract for two inputs (deployed from circomlibjs poseidonContract.createCode(2)).
interface IPoseidon2 {
    function poseidon(uint256[2] calldata inputs) external pure returns (uint256);
}
