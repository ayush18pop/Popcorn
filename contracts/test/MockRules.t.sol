// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AlwaysTrueRule} from "src/mocks/AlwaysTrueRule.sol";
import {FlagRule} from "src/mocks/FlagRule.sol";

/// Delegatecalls the reserved entry points the way Core does (no EIP-8141 needed).
contract Harness {
    address public immutable logic;

    constructor(address l) {
        logic = l;
    }

    function run(bytes calldata data) external returns (bool ok, bytes memory ret) {
        (ok, ret) = logic.delegatecall(data);
    }

    function load(bytes32 slot) external view returns (uint256 v) {
        assembly {
            v := sload(slot)
        }
    }
}

contract RuleContractsTest {
    function _ok(Harness h, bytes memory data) internal returns (bytes memory ret) {
        bool ok;
        (ok, ret) = h.run(data);
        require(ok, "delegatecall failed");
    }

    function test_AlwaysTrue_throughHarness() public {
        AlwaysTrueRule l = new AlwaysTrueRule();
        Harness h = new Harness(address(l));
        bytes memory popArgs = hex"c0ffee";
        require(abi.decode(_ok(h, abi.encodeCall(l.__nonceKey, (popArgs))), (uint256)) == uint256(keccak256(popArgs)), "key");
        require(abi.decode(_ok(h, abi.encodeCall(l.__condition, (popArgs, ""))), (bool)), "cond");
        _ok(h, abi.encodeCall(l.__action, (popArgs, address(h))));
        require(h.load(l.COUNTER_SLOT()) == 1, "counter in rule contract");
    }

    function test_AlwaysTrue_directCallsRevert() public {
        AlwaysTrueRule l = new AlwaysTrueRule();
        (bool a,) = address(l).call(abi.encodeCall(l.__nonceKey, ("")));
        (bool b,) = address(l).call(abi.encodeCall(l.__condition, ("", "")));
        (bool c,) = address(l).call(abi.encodeCall(l.__action, ("", address(this))));
        require(!a && !b && !c, "direct call must revert");
    }

    function test_Flag_offOnFire() public {
        FlagRule l = new FlagRule();
        Harness h = new Harness(address(l));
        bytes memory fire = abi.encode(uint256(0), uint256(1));
        bytes memory on = abi.encode(uint256(1), uint256(1));
        require(!abi.decode(_ok(h, abi.encodeCall(l.__condition, (fire, ""))), (bool)), "fire false while off");
        require(abi.decode(_ok(h, abi.encodeCall(l.__condition, (on, ""))), (bool)), "set_on true");
        _ok(h, abi.encodeCall(l.__action, (on, address(h))));
        require(h.load(l.FLAG_SLOT()) == 1, "flag on");
        require(abi.decode(_ok(h, abi.encodeCall(l.__condition, (fire, ""))), (bool)), "fire true while on");
        _ok(h, abi.encodeCall(l.__action, (fire, address(h))));
        require(h.load(l.COUNTER_SLOT()) == 1, "counter");
        require(!abi.decode(_ok(h, abi.encodeCall(l.__condition, (abi.encode(uint256(9), uint256(0)), ""))), (bool)), "unknown cmd");
    }

    function test_Flag_directCallsRevert() public {
        FlagRule l = new FlagRule();
        (bool a,) = address(l).call(abi.encodeCall(l.__condition, (abi.encode(uint256(1), uint256(0)), "")));
        (bool b,) = address(l).call(abi.encodeCall(l.__action, (abi.encode(uint256(1), uint256(0)), address(this))));
        require(!a && !b, "direct call must revert");
    }
}
