// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title RuleCosts
/// @notice What one rule-pays trigger can cost the rule contract, from its Core args (core/LAYOUT.md "Derivation of check 0x1a").
///         The protocol reserves max_cost = max_fee_per_gas x total_gas_limit from the payer before any frame runs and
///         refunds the unused part, so the rule contract's balance must cover the reservation even though a trigger typically
///         spends far less.
library RuleCosts {
    uint256 internal constant MANDATORY_GAS = 12_950; // 12,000 intrinsic + 2 frames x 475
    uint256 internal constant FLOOR_PER_BYTE = 64; // EIP-7976 floor: 4 tokens/byte x 16
    uint256 internal constant NONCE_RLP_BYTES = 35;
    uint256 internal constant STATE_SLOT_GAS = 97_920; // one fresh storage slot

    /// @notice Upper bound of total_gas_limit for any trigger the rule contract accepts: VERIFY limit <= maxGasPerFrame,
    ///         SENDER limits pinned to the caps, data at the caps.
    function maxGasPerTrigger(uint256 maxGasPerFrame, uint256 maxStateGasPerFrame, uint256 maxVerifyDataLength, uint256 maxTriggerDataLength)
        internal
        pure
        returns (uint256)
    {
        uint256 n1 = 68 + ((maxTriggerDataLength + 31) / 32) * 32;
        return MANDATORY_GAS + FLOOR_PER_BYTE * (maxVerifyDataLength + n1 + NONCE_RLP_BYTES) + 2 * maxGasPerFrame + maxStateGasPerFrame;
    }

    /// @notice Worst-case wei one trigger can reserve (and, for junk-sized data, spend) = minimum operating balance:
    ///         below it no trigger at the caps is includable (the protocol rejects the payer's balance).
    function maxCostPerTrigger(
        uint256 maxFeePerGas,
        uint256 maxGasPerFrame,
        uint256 maxStateGasPerFrame,
        uint256 maxVerifyDataLength,
        uint256 maxTriggerDataLength
    ) internal pure returns (uint256) {
        return maxFeePerGas * maxGasPerTrigger(maxGasPerFrame, maxStateGasPerFrame, maxVerifyDataLength, maxTriggerDataLength);
    }
}
