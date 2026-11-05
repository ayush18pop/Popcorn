// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {RulePays} from "src/payers/RulePays.sol";

/// @title BurnRule contract (test logic: a heavy but mempool-legal condition, local devnet budget test)
/// @notice popArgs = abi.encode(uint256 rounds, uint256 seed). The condition hashes `seed` `rounds` times (KECCAK256
///         over memory only: no banned opcode, no storage, no GAS), so VERIFY really spends ~70 gas per round, then
///         returns true. nonceKey = _hashKey(popArgs) (every distinct popArgs triggers once). action: nothing.
///         Optional self-stake (stakeAmount > 0): trigger with popArgs = STAKE_POP_ARGS first (RuleStake), which makes
///         the rule contract a staked entity on the sidecar (2.5M VERIFY budget instead of 250k).
contract BurnRule is RuleContract, RulePays {
    uint256 public immutable stakeAmount;

    constructor(uint256 stakeAmount_) {
        stakeAmount = stakeAmount_;
    }

    function nonceKey(bytes calldata popArgs) internal pure override returns (uint256) {
        return _hashKey(popArgs);
    }

    function condition(bytes calldata popArgs, bytes calldata) internal pure override returns (bool) {
        uint256 rounds = _word(popArgs, 0);
        bytes32 h = bytes32(_word(popArgs, 1));
        for (uint256 i; i < rounds; ++i) {
            h = keccak256(abi.encode(h, i));
        }
        // true unless the chain lands exactly on 1 (never, in practice); uses h so the loop is not optimized away
        return uint256(h) != 1;
    }

    function action(bytes calldata, address) internal override {}

    function _stakeConfig() internal view virtual override returns (address, uint256, uint32) {
        return (DEVNET_STAKING_REGISTRY, stakeAmount, 86_400);
    }
}
