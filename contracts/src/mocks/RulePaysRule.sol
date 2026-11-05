// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title RulePaysRule contract (test logic for Popcorn Core)
/// @notice Like AlwaysTrueRule contract, but __action also sends 1 wei to `payer` with empty calldata.
///         In rule-pays `payer == address(this)` (the rule contract), so this checks that Core accepts a plain
///         ETH transfer from itself (empty calldata STOPs before the caller == self dispatch).
/// @dev Runs only under DELEGATECALL from a rule contract (Core). A direct call reverts.
contract RulePaysRule {
    bytes32 public constant COUNTER_SLOT = keccak256("popcorn.test.SelfPayKernel.counter");

    address private immutable __self = address(this);

    error DirectCall();
    error PayFailed();

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

    function __action(bytes calldata, address payer) external onlyDelegated {
        (bool ok,) = payer.call{value: 1}("");
        if (!ok) revert PayFailed();
        bytes32 slot = COUNTER_SLOT;
        assembly {
            sstore(slot, add(sload(slot), 1))
        }
    }
}
