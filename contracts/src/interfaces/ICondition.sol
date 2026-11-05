// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICondition
/// @notice A pluggable, stateless condition that a rule contract's logic STATICCALLs during VERIFY.
///         Shared by the rule-set engine and the signed-intent / post-quantum signers.
///
///         Rules for implementations (they run inside the validation prefix):
///         - view, and read NO storage of their own: a predicate contract is not tx.sender, so reading its storage is
///           "another contract's storage" (needs a staked rule contract on ERC-8421, refused by the public mempool). All
///           configuration comes in `params`, which the caller reads from the rule contract's own config.
///         - no banned opcodes (TIMESTAMP, NUMBER, SLOTNUM, BLOCKHASH, BALANCE, GASPRICE, ...; EIP-8141 Mempool).
///         - return false on malformed input instead of reverting where possible; a revert or out-of-gas is treated
///           as false by the caller (fail closed).
///         - bound the gas they forward to precompiles.
///         - msg.sender is the rule contract (the logic runs by DELEGATECALL in the rule contract's context), so a predicate can
///           bind signatures to msg.sender and block.chainid.
interface ICondition {
    /// @param params   static configuration for this node, fixed when the rule contract is configured (e.g. a public key,
    ///                 a threshold, a target address)
    /// @param context  per-trigger binding supplied by the caller: abi.encode(uint256 ruleId, uint256 ruleEpoch,
    ///                 bytes32 popArgsHash). Signature predicates must sign over it so a signature cannot be replayed
    ///                 for another rule, another epoch or other action arguments.
    /// @param witness  per-trigger data chosen by the triggerer, taken from the trigger's verifyData (a signature, a proof, a
    ///                 hint). Never trusted on its own.
    function check(bytes calldata params, bytes calldata context, bytes calldata witness) external view returns (bool);
}
