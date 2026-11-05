// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {RulePays} from "src/payers/RulePays.sol";

/// @title OwnerRule contract (test / demo logic for the hybrid owner path, )
/// @notice A tiny rule-pays rule contract with owner-only functions, a configurable withdraw notice and a configurable
///         stake (amount + unstake delay), so devnet tests can run the whole owner surface in minutes:
///           - ordinary triggers (key = keccak(popArgs): test only) bump a counter;
///           - `setValue(uint256)`, `boom()`, `markStakeDisabled()` are onlyOwnerCall (set / revert / write) ;
///           - `value()` is a forwarded view; the inherited RuleOwner / RuleStake owner functions work as in any rule contract.
contract OwnerRule is RuleContract, RulePays {
    bytes32 public constant VALUE_SLOT = keccak256("popcorn.test.OwnerKernel.value");
    bytes32 public constant COUNTER_SLOT = keccak256("popcorn.test.OwnerKernel.counter");

    uint256 public immutable NOTICE;
    uint256 public immutable STAKE_AMOUNT;
    uint32 public immutable STAKE_DELAY;

    event ValueSet(uint256 value);

    error Boom();

    constructor(uint256 notice_, uint256 stakeAmount_, uint32 stakeDelay_) {
        NOTICE = notice_;
        STAKE_AMOUNT = stakeAmount_;
        STAKE_DELAY = stakeDelay_;
    }

    function nonceKey(bytes calldata popArgs) internal pure override returns (uint256) {
        return _hashKey(popArgs);
    }

    function condition(bytes calldata, bytes calldata) internal pure override returns (bool) {
        return true;
    }

    function action(bytes calldata, address) internal override {
        bytes32 s = COUNTER_SLOT;
        assembly ("memory-safe") {
            sstore(s, add(sload(s), 1))
        }
    }

    function _withdrawNotice() internal view override returns (uint256) {
        return NOTICE;
    }

    function _stakeConfig() internal view override returns (address, uint256, uint32) {
        return (DEVNET_STAKING_REGISTRY, STAKE_AMOUNT, STAKE_DELAY);
    }

    function setValue(uint256 v) external onlyOwnerCall {
        _sstore(VALUE_SLOT, v);
        emit ValueSet(v);
    }

    function boom() external view onlyOwnerCall {
        revert Boom();
    }

    function value() external view returns (uint256) {
        return _sload(VALUE_SLOT);
    }

    function counter() external view returns (uint256) {
        return _sload(COUNTER_SLOT);
    }

    /// @dev NOT guarded: a normal function that tries to reach an owner function internally must still fail.
    function tryOwnerInternally() external {
        (bool ok,) = address(this).call(abi.encodeCall(this.setValue, (999)));
        ok;
    }
}
