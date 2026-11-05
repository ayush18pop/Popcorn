// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreHarness} from "test/CoreHarness.sol";
import {PoolGuard} from "src/examples/PoolGuard.sol";
import {MockGauge} from "src/mocks/RuleSetMocks.sol";

contract PoolGuardTest {
    function test_else_rules_and_the_solidity_action() public {
        MockGauge pool = new MockGauge();
        PoolGuard l = new PoolGuard(address(pool), 100);
        CoreHarness h = new CoreHarness{value: 1 ether}(address(l), 100_000);
        bytes memory a0 = abi.encode(uint256(0));
        bytes memory a1 = abi.encode(uint256(1));
        pool.setValue(50);
        require(!h.condition(a0, "") && h.condition(a1, ""), "below the floor: rule 1");
        pool.setPaused(true);
        require(h.condition(a0, "") && !h.condition(a1, ""), "paused wins (else)");
        h.pop(a0, "");
        require(h.load(l.LAST_RULE_SLOT()) == 1, "the Solidity action ran for rule 0");
        require(!h.condition(a0, ""), "fires once");
        pool.setPaused(false);
        h.pop(a1, "");
        require(h.load(l.LAST_RULE_SLOT()) == 2, "rule 1");
    }
}
