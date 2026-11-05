// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Proof verifier used by ProofCondition rule contracts.
/// Implementations must be view, must not revert on malformed input (return false), and must bound the gas they
/// forward to precompiles so a bad proof cannot burn a VERIFY frame's whole budget.
interface IVerifier {
    /// @param proof   the proof bytes, exactly as carried in the VERIFY frame's data (verifyData)
    /// @param inputs  the public inputs, in the circuit's order
    function verify(bytes calldata proof, uint256[] calldata inputs) external view returns (bool);
}
