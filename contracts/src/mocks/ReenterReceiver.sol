// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Test: an ETH recipient that calls back into the rule contract (a forwarded view) from receive(). During an owner call the SENDER lock is
/// held, so Core must refuse it (0x39) while the payout itself succeeds (the receiver swallows the refusal and records it).
contract ReenterReceiver {
    address public immutable ruleContract;
    bool public reentered;
    bool public reenterOk;
    bytes public reenterRet;

    constructor(address ruleContract_) {
        ruleContract = ruleContract_;
    }

    receive() external payable {
        reentered = true;
        (reenterOk, reenterRet) = ruleContract.call(abi.encodeWithSignature("value()"));
    }
}
