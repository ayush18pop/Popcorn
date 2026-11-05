// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignedIntentCounter} from "src/examples/SignedIntentCounter.sol";

interface IStakeRegistry {
    function addStake(uint32 unstakeDelaySec) external payable;
}

/// @notice Test rule contract for the signed-intent network tests: SignedIntentCounter plus a forwarded `stakeSelf`, so a rule contract whose condition is
///         too heavy for the built-in stake trigger can still be
///         staked: an ordinary transaction to the rule contract is forwarded to this logic, which then calls the registry AS the rule contract
///         (the registry keys stake by msg.sender). Anyone may send value; the stake belongs to the rule contract. TEST ONLY, NEVER COPY INTO PRODUCTION: no example, README or template uses it. Only the account that deployed the logic (`staker`) may call it.
contract IntentTestRule is SignedIntentCounter {
    address internal constant REGISTRY = 0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F;

    address public immutable staker;

    error NotStaker();

    constructor(address predicate_, address paramsBlob_) SignedIntentCounter(predicate_, paramsBlob_) {
        staker = msg.sender;
    }

    function stakeSelf(uint32 unstakeDelaySec) external payable forwarded {
        if (msg.sender != staker) revert NotStaker();
        IStakeRegistry(REGISTRY).addStake{value: msg.value}(unstakeDelaySec);
    }
}
