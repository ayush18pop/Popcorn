// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VerifyDataRule} from "src/mocks/VerifyDataRule.sol";
import {RecorderRule} from "src/mocks/RecorderRule.sol";
import {ReentryRule} from "src/mocks/ReentryRule.sol";
import {MisbehaveRule} from "src/mocks/MisbehaveRule.sol";

/// Delegatecalls a logic the way Core does (no EIP-8141 needed). When called by itself with
/// pop(bytes) calldata it re-enters __action like Core's SENDER branch does, so ReentryRule contract
/// can be exercised end to end; any other self-call reverts with the word 0x30 like Core's
/// SENDER-branch check does when it is not in a SENDER frame (used by MisbehaveRule contract how 7).
contract ProbeHarness {
    address public immutable logic;
    bool public senderMode;

    constructor(address l) {
        logic = l;
    }

    function setSenderMode(bool s) external {
        senderMode = s;
    }

    function run(bytes calldata data) external returns (bool ok, bytes memory ret) {
        (ok, ret) = logic.delegatecall(data);
    }

    function load(bytes32 slot) external view returns (uint256 v) {
        assembly {
            v := sload(slot)
        }
    }

    fallback(bytes calldata data) external payable returns (bytes memory) {
        if (msg.sender != address(this) || data.length == 0) return "";
        if (!senderMode || bytes4(data[:4]) != 0xd9292504) {
            assembly {
                mstore(0, 0x30)
                revert(0, 32)
            }
        }
        bytes memory popArgs = abi.decode(data[4:], (bytes));
        (bool ok, bytes memory ret) = logic.delegatecall(abi.encodeWithSelector(0x6019566d, popArgs, address(this)));
        require(ok, "inner action");
        return ret;
    }
}

contract ProbeRuleContractsTest {
    function _call(ProbeHarness h, bytes memory data) internal returns (bool ok, bytes memory ret) {
        (ok, ret) = h.run(data);
    }

    function _ok(ProbeHarness h, bytes memory data) internal returns (bytes memory ret) {
        bool ok;
        (ok, ret) = h.run(data);
        require(ok, "delegatecall failed");
    }

    function _pattern300() internal pure returns (bytes memory b) {
        b = new bytes(300);
        for (uint256 i; i < 300; i++) b[i] = bytes1(uint8(i * 31 + 7));
    }

    // ------------------------------------------------------------ direct-call guards

    function test_directCallsRevert() public {
        address[4] memory ls = [
            address(new VerifyDataRule()),
            address(new RecorderRule()),
            address(new ReentryRule()),
            address(new MisbehaveRule())
        ];
        for (uint256 i; i < ls.length; i++) {
            (bool a, bytes memory ra) = ls[i].call(abi.encodeWithSelector(0x97031c8c, bytes("")));
            (bool b, bytes memory rb) = ls[i].call(abi.encodeWithSelector(0x05f661f0, bytes(""), bytes("")));
            (bool c, bytes memory rc) = ls[i].call(abi.encodeWithSelector(0x6019566d, bytes(""), address(this)));
            require(!a && !b && !c, "direct call must revert");
            require(bytes4(ra) == 0xdf146856 && bytes4(rb) == 0xdf146856 && bytes4(rc) == 0xdf146856, "DirectCall()");
        }
    }

    // ------------------------------------------------------------ VerifyDataRule contract

    function test_VerifyData_constantIsThePattern() public {
        VerifyDataRule l = new VerifyDataRule();
        require(keccak256(l.EXPECTED_VERIFY_DATA()) == keccak256(_pattern300()), "300-byte pattern");
        require(keccak256(l.EXPECTED_POP_ARGS()) == keccak256("popcorn.test.VerifyDataKernel.popArgs"), "popArgs");
    }

    function test_VerifyData_fixedValue() public {
        VerifyDataRule l = new VerifyDataRule();
        ProbeHarness h = new ProbeHarness(address(l));
        bytes memory pa = l.EXPECTED_POP_ARGS();
        bytes memory vd = _pattern300();
        require(abi.decode(_ok(h, abi.encodeCall(l.__condition, (pa, vd))), (bool)), "exact bytes -> true");
        bytes memory vd2 = _pattern300();
        vd2[299] = bytes1(uint8(vd2[299]) ^ 1);
        require(!abi.decode(_ok(h, abi.encodeCall(l.__condition, (pa, vd2))), (bool)), "vd byte changed -> false");
        bytes memory pa2 = bytes.concat(pa);
        pa2[0] = bytes1(uint8(pa2[0]) ^ 1);
        require(!abi.decode(_ok(h, abi.encodeCall(l.__condition, (pa2, vd))), (bool)), "popArgs byte changed -> false");
        bytes memory vd3 = new bytes(299);
        require(!abi.decode(_ok(h, abi.encodeCall(l.__condition, (pa, vd3))), (bool)), "length 299 -> false");
    }

    function test_VerifyData_hashedForm() public {
        VerifyDataRule l = new VerifyDataRule();
        ProbeHarness h = new ProbeHarness(address(l));
        uint256[4] memory ns = [uint256(0), 31, 32, 33];
        for (uint256 i; i < ns.length; i++) {
            bytes memory vd = new bytes(ns[i]);
            for (uint256 j; j < vd.length; j++) vd[j] = bytes1(uint8(j + 1));
            bytes memory pa = abi.encode(keccak256(vd), vd.length, uint256(7));
            require(abi.decode(_ok(h, abi.encodeCall(l.__condition, (pa, vd))), (bool)), "matching hash/len -> true");
            bytes memory longer = bytes.concat(vd, hex"00");
            require(!abi.decode(_ok(h, abi.encodeCall(l.__condition, (pa, longer))), (bool)), "extra byte -> false");
        }
    }

    function test_VerifyData_keyFollowsEpoch() public {
        VerifyDataRule l = new VerifyDataRule();
        ProbeHarness h = new ProbeHarness(address(l));
        bytes memory pa = l.EXPECTED_POP_ARGS();
        uint256 k0 = abi.decode(_ok(h, abi.encodeCall(l.__nonceKey, (pa))), (uint256));
        require(k0 == uint256(keccak256(abi.encode(pa, uint256(0)))), "key epoch 0");
        _ok(h, abi.encodeCall(l.__action, (pa, address(h))));
        require(h.load(l.EPOCH_SLOT()) == 1, "epoch 1");
        uint256 k1 = abi.decode(_ok(h, abi.encodeCall(l.__nonceKey, (pa))), (uint256));
        require(k1 == uint256(keccak256(abi.encode(pa, uint256(1)))) && k1 != k0, "key epoch 1");
    }

    // ------------------------------------------------------------ RecorderRule contract

    function test_Recorder_records() public {
        RecorderRule l = new RecorderRule();
        ProbeHarness h = new ProbeHarness(address(l));
        bytes memory pa = hex"0102030405";
        require(
            abi.decode(_ok(h, abi.encodeCall(l.__nonceKey, (pa))), (uint256)) == uint256(keccak256(abi.encode(pa, uint256(0)))),
            "key"
        );
        require(abi.decode(_ok(h, abi.encodeCall(l.__condition, (pa, ""))), (bool)), "cond");
        _ok(h, abi.encodeCall(l.__action, (pa, address(0xBEEF))));
        require(h.load(l.EPOCH_SLOT()) == 1, "epoch");
        require(h.load(l.HASH_SLOT()) == uint256(keccak256(pa)), "hash");
        require(h.load(l.META_SLOT()) == (5 << 160) | 0xBEEF, "meta");
        _ok(h, abi.encodeCall(l.__action, (bytes(""), address(h))));
        require(h.load(l.EPOCH_SLOT()) == 2 && h.load(l.HASH_SLOT()) == uint256(keccak256("")), "empty popArgs");
        require(h.load(l.META_SLOT()) == uint256(uint160(address(h))), "meta empty");
    }

    // ------------------------------------------------------------ ReentryRule contract

    function test_Reentry_noReentry() public {
        ReentryRule l = new ReentryRule();
        ProbeHarness h = new ProbeHarness(address(l));
        bytes memory pa = hex"0011";
        require(abi.decode(_ok(h, abi.encodeCall(l.__nonceKey, (pa))), (uint256)) == uint256(keccak256(pa)), "key");
        require(abi.decode(_ok(h, abi.encodeCall(l.__condition, (pa, ""))), (bool)), "cond");
        _ok(h, abi.encodeCall(l.__action, (pa, address(h))));
        require(h.load(l.STATE_SLOT()) == 1, "count 1, result 0");
    }

    function test_Reentry_popCalldataReenters() public {
        ReentryRule l = new ReentryRule();
        ProbeHarness h = new ProbeHarness(address(l));
        h.setSenderMode(true);
        _ok(h, abi.encodeCall(l.__action, (bytes(hex"0111"), address(h))));
        require(h.load(l.STATE_SLOT()) == (1 << 128) | 2, "inner ok, counted twice");
    }

    function test_Reentry_failedInnerCallIsRecorded() public {
        ReentryRule l = new ReentryRule();
        ProbeHarness h = new ProbeHarness(address(l));
        _ok(h, abi.encodeCall(l.__action, (bytes(hex"0211"), address(h))));
        require(h.load(l.STATE_SLOT()) == (2 << 128) | 1, "inner reverted, counted once");
    }

    // ------------------------------------------------------------ MisbehaveRule contract

    function test_Misbehave_nonceKey() public {
        MisbehaveRule l = new MisbehaveRule();
        ProbeHarness h = new ProbeHarness(address(l));
        (bool ok,) = _call(h, abi.encodeCall(l.__nonceKey, (bytes(hex"01"))));
        require(!ok, "how 1 reverts");
        (bool ok2, bytes memory r2) = _call(h, abi.encodeCall(l.__nonceKey, (bytes(hex"02"))));
        require(ok2 && r2.length == 64, "how 2 returns 64 bytes");
        require(abi.decode(_ok(h, abi.encodeCall(l.__nonceKey, (bytes(hex"03")))), (uint256)) == 0, "how 3 returns 0");
        require(
            abi.decode(_ok(h, abi.encodeCall(l.__nonceKey, (bytes(hex"0055")))), (uint256)) == uint256(keccak256(hex"0055")),
            "default key"
        );
    }

    function test_Misbehave_condition() public {
        MisbehaveRule l = new MisbehaveRule();
        ProbeHarness h = new ProbeHarness(address(l));
        (bool ok,) = _call(h, abi.encodeCall(l.__condition, (bytes(hex"04"), bytes(""))));
        require(!ok, "how 4 reverts");
        (bool ok5, bytes memory r5) = _call(h, abi.encodeCall(l.__condition, (bytes(hex"05"), bytes(""))));
        require(ok5 && r5.length == 64, "how 5 returns 64 bytes");
        (bool ok6, bytes memory r6) = _call(h, abi.encodeCall(l.__condition, (bytes(hex"06"), bytes(""))));
        require(ok6 && r6.length == 32 && abi.decode(r6, (uint256)) == 2, "how 6 returns 2");
        // how 7: harness answers a non-SENDER self-call with the word 0x30, like Core in VERIFY
        require(abi.decode(_ok(h, abi.encodeCall(l.__condition, (bytes(hex"07"), bytes("")))), (bool)), "how 7 sees 0x30");
        require(abi.decode(_ok(h, abi.encodeCall(l.__condition, (bytes(hex"00"), bytes("")))), (bool)), "default true");
    }

    function test_Misbehave_actionSendsEth() public {
        MisbehaveRule l = new MisbehaveRule();
        ProbeHarness h = new ProbeHarness(address(l));
        (bool funded,) = address(h).call{value: 10}("");
        require(funded, "fund");
        _ok(h, abi.encodeCall(l.__action, (bytes(hex"08"), address(h))));
        require(h.load(l.RESULT_SLOT()) == 1, "how 8 send to self ok");
        _ok(h, abi.encodeCall(l.__action, (bytes(hex"09"), address(0xdead))));
        require(h.load(l.RESULT_SLOT()) == 1 && address(0xdead).balance == 1, "how 9 send to payer ok");
    }
}
