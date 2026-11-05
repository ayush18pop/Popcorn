// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {GasProbeRule} from "src/mocks/GasProbeRule.sol";

contract ProbeHarness {
    address immutable logic;

    constructor(address l) {
        logic = l;
    }

    function cond(uint256 g, bytes calldata data) external returns (bool ok, bool r) {
        bytes memory ret;
        (ok, ret) = logic.delegatecall{gas: g}(data);
        if (ok) r = abi.decode(ret, (bool));
    }
}

/// ENTRY_GAS of GasProbeRule contract.__condition: gas spent before its gasleft() (dispatch + ABI checks).
/// The devnet measurement sets want = conditionGas - ENTRY_GAS.
contract GasProbeTest {
    event log_named_uint(string key, uint256 val);

    uint256 constant ENTRY_GAS = 633;

    function _entry(ProbeHarness h, uint256 g, bytes memory popArgs, bytes memory vd) internal returns (uint256) {
        uint256 lo = 0;
        uint256 hi = g;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            bytes memory pa = bytes.concat(abi.encode(mid, uint256(0)), popArgs);
            (bool ok, bool r) = h.cond(g, abi.encodeCall(GasProbeRule.__condition, (pa, vd)));
            if (ok && r) lo = mid;
            else hi = mid - 1;
        }
        return g - lo;
    }

    function test_entryGas() public {
        ProbeHarness h = new ProbeHarness(address(new GasProbeRule()));
        uint256 e1 = _entry(h, 20_000, "", "");
        uint256 e2 = _entry(h, 200_000, new bytes(960), new bytes(1024));
        emit log_named_uint("entry gas (20k, empty)", e1);
        emit log_named_uint("entry gas (200k, 1024/1024)", e2);
        require(e1 == ENTRY_GAS && e2 == ENTRY_GAS, "ENTRY_GAS changed: update it and the measurement script");
    }
}
