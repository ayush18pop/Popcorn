// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title AlwaysTrueRule contract (test logic for Popcorn Core)
/// @notice Condition is always true. Every distinct popArgs triggers exactly once:
///         nonceKey = uint256(keccak256(popArgs)) (Core requires sequence 0 on that key).
///         The action increments a counter at a namespaced slot of the rule contract.
/// @dev Runs only under DELEGATECALL from a rule contract (Core). A direct call reverts.
contract AlwaysTrueRule {
    bytes32 public constant COUNTER_SLOT = keccak256("popcorn.test.AlwaysTrueKernel.counter");

    address private immutable __self = address(this);

    error DirectCall();

    modifier onlyDelegated() {
        if (address(this) == __self) revert DirectCall();
        _;
    }

    function __nonceKey(bytes calldata popArgs) external view onlyDelegated returns (uint256) {
        return uint256(keccak256(popArgs));
    }

    function __condition(bytes calldata, bytes calldata) external view onlyDelegated returns (bool) {
        return true;
    }

    function __action(bytes calldata, address) external onlyDelegated {
        bytes32 slot = COUNTER_SLOT;
        assembly {
            sstore(slot, add(sload(slot), 1))
        }
    }
}
