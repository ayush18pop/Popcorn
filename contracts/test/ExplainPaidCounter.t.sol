// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreHarness} from "test/CoreHarness.sol";
import {ExplainCheck} from "test/ExplainCheck.sol";
import {PaidCounter} from "src/examples/PaidCounter.sol";

/// The Open Gas Network's app account explains its one trigger, and agrees with its condition armed and disarmed.
contract ExplainPaidCounterTest {
    function test_flow_agrees_armed_and_disarmed() public {
        CoreHarness h = new CoreHarness(address(new PaidCounter(0)), 30_000);
        require(!ExplainCheck.cond(h, "", ""), "disarmed: the flow stops at armed");
        PaidCounter(payable(address(h))).arm();
        require(ExplainCheck.cond(h, "", ""), "armed: the action runs");
    }
}
