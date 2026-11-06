// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreHarness} from "test/CoreHarness.sol";
import {RuleSetContract} from "src/rules/RuleSetContract.sol";
import {RuleSet} from "src/rules/RuleSet.sol";
import "src/rules/RuleSetCodec.sol";
import {MockGauge, MockReverter, MockBurner, MockShortReturn, MockSigner, MockToggle} from "src/mocks/RuleSetMocks.sol";

interface Vm {
    function store(address, bytes32, bytes32) external;
    function deal(address, uint256) external;
    function etch(address, bytes calldata) external;
}

/// External wrapper so tests can catch the validator's reverts.
contract RuleSetValidator {
    function validate(bytes calldata c) external pure {
        RuleSetCodec.validate(c);
    }
}

abstract contract RuleSetBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockGauge internal g = new MockGauge();
    RuleSetValidator internal val = new RuleSetValidator();
    uint32 internal constant GAS = 30_000;

    receive() external payable {}

    // ---- builders
    function k1(bytes memory a) internal pure returns (bytes[] memory k) {
        k = new bytes[](1);
        k[0] = a;
    }

    function k2(bytes memory a, bytes memory b) internal pure returns (bytes[] memory k) {
        k = new bytes[](2);
        k[0] = a;
        k[1] = b;
    }

    function k3(bytes memory a, bytes memory b, bytes memory c) internal pure returns (bytes[] memory k) {
        k = new bytes[](3);
        k[0] = a;
        k[1] = b;
        k[2] = c;
    }

    function T() internal pure returns (bytes memory) {
        return RuleSetCodec.constant_(true);
    }

    function F() internal pure returns (bytes memory) {
        return RuleSetCodec.constant_(false);
    }

    function gv() internal view returns (bytes memory) {
        return RuleSetCodec.srcGetter(address(g), g.value.selector, GAS);
    }

    function cmpV(uint8 op, uint256 x) internal view returns (bytes memory) {
        return RuleSetCodec.cmp(gv(), op, x);
    }

    function one(bytes memory tree) internal pure returns (bytes memory) {
        return oneMax(tree, 0);
    }

    function oneMax(bytes memory tree, uint16 maxFires) internal pure returns (bytes memory) {
        RuleSetCodec.Rule[] memory r = new RuleSetCodec.Rule[](1);
        r[0] = RuleSetCodec.rule(tree, maxFires, ACTION_NONE, "", 0);
        return RuleSetCodec.encode(0, r);
    }

    function rules3(uint8 mode, bytes memory a, bytes memory b, bytes memory c, uint16 maxFires) internal pure returns (bytes memory) {
        RuleSetCodec.Rule[] memory r = new RuleSetCodec.Rule[](3);
        r[0] = RuleSetCodec.rule(a, maxFires, ACTION_NONE, "", 0);
        r[1] = RuleSetCodec.rule(b, maxFires, ACTION_NONE, "", 0);
        r[2] = RuleSetCodec.rule(c, maxFires, ACTION_NONE, "", 0);
        return RuleSetCodec.encode(mode, r);
    }

    function deploy(bytes memory cfg) internal returns (CoreHarness h) {
        return deployGas(cfg, 200_000);
    }

    function deployGas(bytes memory cfg, uint256 condGas) internal returns (CoreHarness h) {
        RuleSetContract l = new RuleSetContract(cfg, 0);
        h = new CoreHarness{value: 1 ether}(address(l), condGas);
    }

    function args(uint256 ruleId) internal pure returns (bytes memory) {
        return abi.encode(ruleId);
    }

    function wit(uint16 id, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodePacked(id, uint16(data.length), data);
    }

    function hint(uint16 id, uint8 child) internal pure returns (bytes memory) {
        return wit(id, abi.encodePacked(child));
    }

    function passes(CoreHarness h, uint256 ruleId, bytes memory w_) internal returns (bool) {
        return h.condition(args(ruleId), w_);
    }

    function passes(CoreHarness h, uint256 ruleId) internal returns (bool) {
        return h.condition(args(ruleId), "");
    }

    function fires(CoreHarness h, uint256 ruleId, bytes memory w_) internal returns (bool ok) {
        try h.pop(args(ruleId), w_) returns (uint256) {
            return true;
        } catch {
            return false;
        }
    }

    function req(bool c, string memory m) internal pure {
        require(c, m);
    }

    function validates(bytes memory cfg) internal view returns (bool ok) {
        try val.validate(cfg) {
            return true;
        } catch {
            return false;
        }
    }
}

contract RuleSetTest is RuleSetBase {
    // ================================================================ codec / validator

    function test_validate_accepts_simple_and_nested() public view {
        req(validates(one(T())), "single const");
        bytes memory nested = RuleSetCodec.and_(k3(cmpV(OP_GT, 1), RuleSetCodec.or_(k2(F(), T())), RuleSetCodec.not_(RuleSetCodec.kofn(2, k3(T(), F(), F())))));
        req(validates(one(nested)), "nested");
    }

    function test_validate_rejects_structural_errors() public {
        bytes memory good = one(T());
        // truncated, bad version, bad mode, zero rules
        req(!validates(hex"01"), "short");
        bytes memory c = good;
        c[0] = 0x02;
        req(!validates(c), "version");
        c = good;
        c[1] = 0x02;
        req(!validates(c), "mode");
        // trailing byte
        req(!validates(bytes.concat(good, hex"00")), "trailing");
        // node count in the header disagrees
        c = good;
        c[4] = 0x02;
        req(!validates(c), "node count mismatch");
        // child count: kofn k > n and k == 0, NOT with two children, AND with no children
        req(!validates(one(RuleSetCodec.kofn(3, k2(T(), T())))), "k > n");
        req(!validates(one(RuleSetCodec.kofn(0, k2(T(), T())))), "k = 0");
        req(!validates(one(RuleSetCodec.exactly(3, k2(T(), T())))), "exactly: k > n");
        req(!validates(one(RuleSetCodec.exactly(0, k2(T(), T())))), "exactly: k = 0");
        req(!validates(one(RuleSetCodec.node(T_NOT, "", k2(T(), T())))), "not with 2");
        req(!validates(one(RuleSetCodec.node(T_AND, "", new bytes[](0)))), "and with 0");
        // unknown node type and bad leaf fields
        req(!validates(one(RuleSetCodec.leaf(0x30, ""))), "unknown type");
        req(!validates(one(RuleSetCodec.leaf(T_CONST, hex"02"))), "const 2");
        req(!validates(one(RuleSetCodec.cmp(gv(), 9, 0))), "op 9");
        req(!validates(one(RuleSetCodec.range(gv(), 5, 4, false))), "lo > hi");
        req(!validates(one(RuleSetCodec.ratio(gv(), gv(), OP_GT, 1, 0))), "den 0");
        req(!validates(one(RuleSetCodec.cmp(RuleSetCodec.source(9, 0, 0, address(0), bytes4(0), 0), OP_GT, 0))), "source kind");
        req(!validates(one(RuleSetCodec.cmp(RuleSetCodec.srcGetter(address(g), g.value.selector, 0), OP_GT, 0))), "getter without a gas cap");
        req(!validates(one(RuleSetCodec.delta(gv(), 0, DIR_UP, 0, 0))), "delta 0 bps");
        req(!validates(one(RuleSetCodec.delta(gv(), 10_001, DIR_DOWN, 0, 0))), "fall of more than 100%");
        req(validates(one(RuleSetCodec.delta(gv(), 20_000, DIR_UP, 0, 0))), "rise of 200% ok");
    }

    function test_validate_bounds_depth_nodes_children_size() public {
        // depth: 8 nested NOTs around a leaf is depth 9 -> rejected; 7 NOTs (depth 8) ok
        bytes memory t = T();
        for (uint256 i; i < 7; ++i) t = RuleSetCodec.not_(t);
        req(validates(one(t)), "depth 8");
        t = RuleSetCodec.not_(t);
        req(!validates(one(t)), "depth 9");
        // children: 16 ok, 17 rejected
        bytes[] memory kids = new bytes[](16);
        for (uint256 i; i < 16; ++i) kids[i] = T();
        req(validates(one(RuleSetCodec.and_(kids))), "16 children");
        kids = new bytes[](17);
        for (uint256 i; i < 17; ++i) kids[i] = T();
        req(!validates(one(RuleSetCodec.and_(kids))), "17 children");
        // nodes: 64 ok (4 ANDs of 15 leaves + root 5 = 65?) build 63 leaves + root = 64
        bytes[] memory a = new bytes[](16);
        bytes[] memory b = new bytes[](16);
        bytes[] memory c2 = new bytes[](16);
        bytes[] memory d = new bytes[](15);
        for (uint256 i; i < 16; ++i) {
            a[i] = T();
            b[i] = T();
            c2[i] = T();
        }
        for (uint256 i; i < 15; ++i) d[i] = T();
        // 4 AND nodes + 63 leaves + 1 root = 68: too many; use ORs of leaves directly under one AND instead:
        bytes[] memory top = new bytes[](4);
        top[0] = RuleSetCodec.and_(a); // 17 nodes
        top[1] = RuleSetCodec.and_(b); // 17
        top[2] = RuleSetCodec.and_(c2); // 17
        top[3] = RuleSetCodec.and_(d); // 16   -> 67 + root = 68
        req(!validates(one(RuleSetCodec.and_(top))), "68 nodes");
        top[3] = RuleSetCodec.and_(k1(T())); // 2 -> 17*3 + 2 + 1 = 54
        req(validates(one(RuleSetCodec.and_(top))), "54 nodes");
        // 17 rules
        RuleSetCodec.Rule[] memory r = new RuleSetCodec.Rule[](17);
        for (uint256 i; i < 17; ++i) r[i] = RuleSetCodec.rule(T(), 0, ACTION_NONE, "", 0);
        req(!validates(RuleSetCodec.encode(0, r)), "17 rules");
        // config size: a predicate with 1,024 params is fine, one with 1,025 is not
        req(validates(one(RuleSetCodec.predicate(address(1), 10_000, new bytes(1024)))), "params 1024");
        req(!validates(one(RuleSetCodec.predicate(address(1), 10_000, new bytes(1025)))), "params 1025");
        // total config bytes over 16 KB: 64 ratio leaves (198 bytes each) = 12.7 KB fits; 100 nodes cannot be built, so use params
        bytes[] memory preds = new bytes[](16);
        bytes[] memory preds2 = new bytes[](16);
        for (uint256 i; i < 16; ++i) {
            preds[i] = RuleSetCodec.predicate(address(1), 10_000, new bytes(1000));
            preds2[i] = RuleSetCodec.predicate(address(1), 10_000, new bytes(1000));
        }
        bytes[] memory two = new bytes[](2);
        two[0] = RuleSetCodec.and_(preds);
        two[1] = RuleSetCodec.and_(preds2); // 32 * 1,031 bytes > 16 KB
        req(!validates(one(RuleSetCodec.and_(two))), "config over 16 KB");
    }

    function test_validate_predicate_polarity() public {
        bytes memory p = RuleSetCodec.predicate(address(1), 10_000, "");
        req(validates(one(RuleSetCodec.and_(k2(T(), p)))), "predicate under AND ok");
        req(validates(one(RuleSetCodec.or_(k2(F(), p)))), "predicate under OR ok");
        req(validates(one(RuleSetCodec.kofn(1, k2(p, T())))), "predicate under k-of-n ok");
        req(!validates(one(RuleSetCodec.not_(p))), "predicate under NOT refused");
        req(!validates(one(RuleSetCodec.exactly(1, k2(p, T())))), "predicate under exactly-one refused (its no is not exact)");
        req(!validates(one(RuleSetCodec.not_(RuleSetCodec.and_(k2(T(), p))))), "predicate deep under NOT refused");
        req(validates(one(RuleSetCodec.not_(RuleSetCodec.not_(p)))) == false, "double NOT still exact");
        // else mode: trees 0..n-2 are evaluated exactly by later rules -> no predicate there, last rule may have one
        req(!validates(rules3(1, p, T(), T(), 0)), "else: predicate in rule 0 refused");
        req(!validates(rules3(1, T(), p, T(), 0)), "else: predicate in rule 1 refused");
        req(validates(rules3(1, T(), T(), p, 0)), "else: predicate in the last rule ok");
        req(validates(rules3(0, p, p, p, 0)), "independent: predicates anywhere");
    }

    function test_validate_rule_table_and_actions() public {
        RuleSetCodec.Rule[] memory r = new RuleSetCodec.Rule[](1);
        r[0] = RuleSetCodec.rule(T(), 0, ACTION_CALL, RuleSetCodec.actionCall(address(g), 0, ""), 50_000);
        req(validates(RuleSetCodec.encode(0, r)), "call action");
        r[0] = RuleSetCodec.rule(T(), 0, ACTION_CALL, RuleSetCodec.actionCall(address(g), 0, ""), 0);
        req(!validates(RuleSetCodec.encode(0, r)), "call without gas");
        r[0] = RuleSetCodec.rule(T(), 0, 7, "", 0);
        req(!validates(RuleSetCodec.encode(0, r)), "unknown action type");
        r[0] = RuleSetCodec.rule(T(), 0, ACTION_CALL, hex"aabb", 50_000);
        req(!validates(RuleSetCodec.encode(0, r)), "call body too short");
        r[0] = RuleSetCodec.rule(T(), 0, ACTION_CALL, RuleSetCodec.actionCall(address(g), 0, new bytes(1025)), 50_000);
        req(!validates(RuleSetCodec.encode(0, r)), "call data over 1,024");
    }

    function test_constructor_rejects_oversize_config() public {
        bytes memory bad = one(RuleSetCodec.kofn(3, k2(T(), T())));
        bool reverted;
        try new RuleSetContract(bad, 0) {} catch {
            reverted = true;
        }
        req(reverted, "constructor must refuse an invalid config");
    }

    // ================================================================ leaves

    function test_cmp_ops_at_the_boundary() public {
        uint256 line = 1000;
        uint8[6] memory ops = [OP_GT, OP_GE, OP_LT, OP_LE, OP_EQ, OP_NE];
        // expected truth for v = line-1, line, line+1
        bool[3][6] memory want = [[false, false, true], [false, true, true], [true, false, false], [true, true, false], [false, true, false], [true, false, true]];
        for (uint256 o; o < 6; ++o) {
            CoreHarness h = deploy(one(cmpV(ops[o], line)));
            for (uint256 i; i < 3; ++i) {
                g.setValue(line - 1 + i);
                req(passes(h, 0) == want[o][i], string.concat("op ", _s(o), " at ", _s(i)));
            }
        }
    }

    function test_storage_source_reads_the_ruleContracts_own_slot() public {
        bytes32 slot = keccak256("test.slot");
        CoreHarness h = deploy(one(RuleSetCodec.cmp(RuleSetCodec.srcStorage(slot), OP_GE, 5)));
        req(!passes(h, 0), "unset");
        vm.store(address(h), slot, bytes32(uint256(5)));
        req(passes(h, 0), "5 >= 5");
        // another contract's storage at the same slot does not matter
        vm.store(address(g), slot, bytes32(uint256(0)));
        req(passes(h, 0), "own storage only");
    }

    function test_range_inside_and_outside() public {
        CoreHarness inside = deploy(one(RuleSetCodec.range(gv(), 100, 200, false)));
        CoreHarness outside = deploy(one(RuleSetCodec.range(gv(), 100, 200, true)));
        uint256[5] memory vs = [uint256(99), 100, 150, 200, 201];
        bool[5] memory wantIn = [false, true, true, true, false];
        for (uint256 i; i < 5; ++i) {
            g.setValue(vs[i]);
            req(passes(inside, 0) == wantIn[i], "inside");
            req(passes(outside, 0) == !wantIn[i], "outside");
        }
    }

    function test_crossing_once_per_crossing_and_shared_slot() public {
        // rule 0: crossing up over 100 (slot 3), rule 1: crossing down (same slot): firing either re-arms the other
        RuleSetCodec.Rule[] memory r = new RuleSetCodec.Rule[](2);
        r[0] = RuleSetCodec.rule(RuleSetCodec.crossing(gv(), 100, DIR_UP, 50, 3), 0, ACTION_NONE, "", 0);
        r[1] = RuleSetCodec.rule(RuleSetCodec.crossing(gv(), 100, DIR_DOWN, 50, 3), 0, ACTION_NONE, "", 0);
        CoreHarness h = deploy(RuleSetCodec.encode(0, r));
        g.setValue(80);
        req(!passes(h, 0) && !passes(h, 1), "below, baseline 50: nothing");
        g.setValue(150);
        req(passes(h, 0) && !passes(h, 1), "up-crossing from the initial baseline");
        req(fires(h, 0, ""), "fire up");
        req(h.load(bytes32(uint256(keccak256("popcorn.ruleset.checkpoint")) + 3)) == 151, "checkpoint = value + 1");
        req(!passes(h, 0), "the same crossing does not fire twice");
        req(!passes(h, 1), "still above");
        g.setValue(40);
        req(passes(h, 1) && !passes(h, 0), "down-crossing now");
        req(fires(h, 1, ""), "fire down (re-arms rule 0 through the shared slot)");
        g.setValue(120);
        req(passes(h, 0), "up again");
        // a value at or above 2^255 is unknown, never a crossing
        g.setValue(uint256(1) << 255);
        req(!passes(h, 0), "huge value fails closed");
    }

    function test_crossing_either_and_line_touch() public {
        CoreHarness h = deploy(one(RuleSetCodec.crossing(gv(), 100, DIR_EITHER, 100, 0)));
        g.setValue(100);
        req(!passes(h, 0), "exactly on the line is not a crossing");
        g.setValue(101);
        req(passes(h, 0), "baseline 100 (on the line) then 101: crossed up");
        g.setValue(99);
        req(passes(h, 0), "baseline 100 then 99: crossed down");
    }

    function test_delta_percent_up_down_either() public {
        // base 1000, 10% = 1000 bps
        CoreHarness up = deploy(one(RuleSetCodec.delta(gv(), 1000, DIR_UP, 1000, 0)));
        CoreHarness down = deploy(one(RuleSetCodec.delta(gv(), 1000, DIR_DOWN, 1000, 0)));
        CoreHarness either = deploy(one(RuleSetCodec.delta(gv(), 1000, DIR_EITHER, 1000, 0)));
        uint256[7] memory vs = [uint256(899), 900, 901, 1000, 1099, 1100, 1101];
        bool[7] memory wUp = [false, false, false, false, false, true, true];
        bool[7] memory wDown = [true, true, false, false, false, false, false];
        for (uint256 i; i < 7; ++i) {
            g.setValue(vs[i]);
            req(passes(up, 0) == wUp[i], string.concat("up ", _s(vs[i])));
            req(passes(down, 0) == wDown[i], string.concat("down ", _s(vs[i])));
            req(passes(either, 0) == (wUp[i] || wDown[i]), string.concat("either ", _s(vs[i])));
        }
        // base 0 and moving up counts, staying at 0 does not
        CoreHarness zero = deploy(one(RuleSetCodec.delta(gv(), 500, DIR_UP, 0, 0)));
        g.setValue(0);
        req(!passes(zero, 0), "0 -> 0");
        g.setValue(1);
        req(passes(zero, 0), "0 -> 1");
    }

    function test_delta_checkpoint_moves_after_fire() public {
        CoreHarness h = deploy(one(RuleSetCodec.delta(gv(), 1000, DIR_UP, 1000, 0)));
        g.setValue(1200);
        req(fires(h, 0, ""), "fire at +20%");
        req(!passes(h, 0), "checkpoint is 1200 now, 1200 is not +10% of it");
        g.setValue(1320);
        req(passes(h, 0), "+10% of 1200");
    }

    function test_ratio_overflow_safe() public {
        // a/b >= 3/2
        CoreHarness h = deploy(one(RuleSetCodec.ratio(gv(), RuleSetCodec.srcGetter(address(g), g.other.selector, GAS), OP_GE, 3, 2)));
        g.setOther(100);
        g.setValue(149);
        req(!passes(h, 0), "1.49");
        g.setValue(150);
        req(passes(h, 0), "1.50");
        // huge operands: a*den and num*b overflow 256 bits; still exact
        uint256 big = type(uint256).max / 2;
        g.setOther(big);
        g.setValue(big); // ratio 1 < 3/2
        req(!passes(h, 0), "big, 1.0");
        g.setValue(type(uint256).max); // ~2.0 >= 1.5
        req(passes(h, 0), "big, ~2.0");
        // b == 0 is unknown, never true; also under NOT
        g.setOther(0);
        req(!passes(h, 0), "b = 0");
        CoreHarness n = deploy(one(RuleSetCodec.not_(RuleSetCodec.ratio(gv(), RuleSetCodec.srcGetter(address(g), g.other.selector, GAS), OP_GE, 3, 2))));
        req(!passes(n, 0), "NOT(unknown) is not true");
        // LT / EQ / NE / GT
        g.setOther(3);
        g.setValue(2);
        CoreHarness eq = deploy(one(RuleSetCodec.ratio(gv(), RuleSetCodec.srcGetter(address(g), g.other.selector, GAS), OP_EQ, 4, 6)));
        req(passes(eq, 0), "2/3 == 4/6");
    }

    function test_eth_balance_self_and_other() public {
        address other = address(0xBEEF);
        CoreHarness h = deploy(one(RuleSetCodec.and_(k2(RuleSetCodec.cmp(RuleSetCodec.srcEthBalanceSelf(), OP_GE, 2 ether), RuleSetCodec.cmp(RuleSetCodec.srcEthBalance(other), OP_LT, 1 ether)))));
        req(!passes(h, 0), "rule contract holds 1 ether");
        vm.deal(address(h), 2 ether);
        req(passes(h, 0), "2 ether, other empty");
        vm.deal(other, 1 ether);
        req(!passes(h, 0), "other has 1 ether");
    }

    function test_erc20_balance_of_ruleContract_and_of_an_account() public {
        address who = address(0xCAFE);
        CoreHarness h = deploy(rules3(0, RuleSetCodec.cmp(RuleSetCodec.srcErc20Self(address(g), GAS), OP_GE, 500), RuleSetCodec.cmp(RuleSetCodec.srcErc20(address(g), who, GAS), OP_LT, 10), T(), 0));
        req(!passes(h, 0), "rule contract has 0");
        g.setBalance(address(h), 500);
        req(passes(h, 0), "rule contract has 500");
        req(passes(h, 1), "who has 0 < 10");
        g.setBalance(who, 10);
        req(!passes(h, 1), "who has 10");
    }

    function test_codehash_changed_and_unchanged() public {
        address watched = address(new MockGauge());
        bytes32 recorded = watched.codehash;
        CoreHarness changed = deploy(one(RuleSetCodec.codehash(watched, recorded, false)));
        CoreHarness same = deploy(one(RuleSetCodec.codehash(watched, recorded, true)));
        req(!passes(changed, 0) && passes(same, 0), "unchanged");
        vm.etch(watched, hex"6000");
        req(passes(changed, 0) && !passes(same, 0), "changed");
    }

    function test_state_flag_bool_and_enum() public {
        CoreHarness paused = deploy(one(RuleSetCodec.cmp(RuleSetCodec.srcGetter(address(g), g.paused.selector, GAS), OP_EQ, 1)));
        CoreHarness phase2 = deploy(one(RuleSetCodec.cmp(RuleSetCodec.srcGetter(address(g), g.phase.selector, GAS), OP_EQ, 2)));
        req(!passes(paused, 0) && !passes(phase2, 0), "initial");
        g.setPaused(true);
        g.setPhase(2);
        req(passes(paused, 0) && passes(phase2, 0), "flipped");
    }

    // ================================================================ fail closed

    function test_failed_reads_are_unknown_never_true_even_under_not() public {
        address[3] memory bad = [address(new MockReverter()), address(new MockBurner()), address(new MockShortReturn())];
        address noCode = address(0xDEAD);
        for (uint256 i; i < 4; ++i) {
            address t = i < 3 ? bad[i] : noCode;
            bytes memory leaf_ = RuleSetCodec.cmp(RuleSetCodec.srcGetter(t, g.value.selector, 20_000), OP_GE, 0);
            CoreHarness plain = deploy(one(leaf_));
            CoreHarness neg = deploy(one(RuleSetCodec.not_(leaf_)));
            CoreHarness negneg = deploy(one(RuleSetCodec.not_(RuleSetCodec.not_(leaf_))));
            req(!passes(plain, 0), "failed read is not true");
            req(!passes(neg, 0), "NOT(failed read) is not true");
            req(!passes(negneg, 0), "NOT(NOT(failed read)) is not true");
            // else mode: an earlier tree that cannot be read is not "definitely false", so the later rule cannot fire
            CoreHarness el = deploy(rules3(1, leaf_, T(), T(), 0));
            req(!passes(el, 1), "else: unknown earlier tree blocks the next rule");
            // AND with a definite false still answers false, OR with a definite true still answers true
            req(!passes(deploy(one(RuleSetCodec.and_(k2(leaf_, F())))), 0), "AND(unknown,false)");
        }
        // OR(unknown, true) is true with a hint at the true child (both orders)
        bytes memory bad0 = RuleSetCodec.cmp(RuleSetCodec.srcGetter(bad[0], g.value.selector, 20_000), OP_GE, 0);
        CoreHarness orH = deploy(one(RuleSetCodec.or_(k2(bad0, T()))));
        req(passes(orH, 0, hint(0, 1)), "OR hint at the true child");
        req(!passes(orH, 0, hint(0, 0)), "OR hint at the failing child");
    }

    function test_burner_is_capped_per_node() public {
        // a gas-burning target cannot starve the rest of the tree: it is cut at its own cap
        bytes memory burner = RuleSetCodec.cmp(RuleSetCodec.srcGetter(address(new MockBurner()), g.value.selector, 15_000), OP_GE, 0);
        // Gas is compared with a control tree of the same shape without the burner, so the harness's own call
        // overhead cancels out and only the burner's cost remains.
        CoreHarness c = deployGas(one(RuleSetCodec.or_(k2(F(), T()))), 100_000);
        uint256 before = gasleft();
        passes(c, 0, hint(0, 1));
        uint256 control = before - gasleft();
        CoreHarness h = deployGas(one(RuleSetCodec.or_(k2(burner, T()))), 100_000);
        before = gasleft();
        bool ok = passes(h, 0, hint(0, 1));
        uint256 used = before - gasleft();
        req(ok, "true child still evaluated");
        req(used < control + 5_000, "the burner did not run (hint named the other child)");
        // exact context (under NOT of an OR): every child runs, the burner stops at its 15k cap
        CoreHarness nc = deployGas(one(RuleSetCodec.not_(RuleSetCodec.or_(k2(F(), F())))), 100_000);
        before = gasleft();
        passes(nc, 0);
        control = before - gasleft();
        CoreHarness n = deployGas(one(RuleSetCodec.not_(RuleSetCodec.or_(k2(burner, F())))), 100_000);
        before = gasleft();
        ok = passes(n, 0);
        used = before - gasleft();
        req(!ok, "unknown");
        req(used > control + 15_000 && used < control + 40_000, "burner ran and was capped at 15k");
    }

    // ================================================================ composition

    function test_and_or_not_truth_tables_and_short_circuit() public {
        bool[2] memory bs = [false, true];
        for (uint256 a; a < 2; ++a) {
            for (uint256 b; b < 2; ++b) {
                bytes memory A = bs[a] ? T() : F();
                bytes memory B = bs[b] ? T() : F();
                req(passes(deploy(one(RuleSetCodec.and_(k2(A, B)))), 0) == (bs[a] && bs[b]), "and");
                // OR: the triggerer names the true child (or child 0 when none is true)
                uint8 idx = bs[a] ? 0 : 1;
                req(passes(deploy(one(RuleSetCodec.or_(k2(A, B)))), 0, hint(0, idx)) == (bs[a] || bs[b]), "or");
                req(passes(deploy(one(RuleSetCodec.not_(A))), 0) == !bs[a], "not");
            }
        }
        // AND short-circuits: the second child (a burner at 25k) is never called when the first is false
        bytes memory burner = RuleSetCodec.cmp(RuleSetCodec.srcGetter(address(new MockBurner()), g.value.selector, 25_000), OP_GE, 0);
        CoreHarness h1 = deployGas(one(RuleSetCodec.and_(k2(F(), burner))), 100_000);
        uint256 before = gasleft();
        req(!passes(h1, 0), "false");
        uint256 cheap = before - gasleft();
        CoreHarness h2 = deployGas(one(RuleSetCodec.and_(k2(T(), burner))), 100_000);
        before = gasleft();
        req(!passes(h2, 0), "burner child");
        uint256 dear = before - gasleft();
        req(dear > cheap + 25_000 && dear < cheap + 45_000, "the burner only ran when reached, and was capped at 25k");
    }

    function test_or_hint_wrong_missing_out_of_range_and_only_that_child_runs() public {
        bytes memory burner = RuleSetCodec.cmp(RuleSetCodec.srcGetter(address(new MockBurner()), g.value.selector, 25_000), OP_GE, 0);
        CoreHarness c = deployGas(one(RuleSetCodec.or_(k3(F(), F(), T()))), 150_000);
        uint256 before = gasleft();
        passes(c, 0, hint(0, 2));
        uint256 control = before - gasleft();
        CoreHarness h = deployGas(one(RuleSetCodec.or_(k3(burner, F(), T()))), 150_000);
        before = gasleft();
        req(passes(h, 0, hint(0, 2)), "right hint");
        req(before - gasleft() < control + 5_000, "only the hinted child ran (the burner did not)");
        req(!passes(h, 0, hint(0, 1)), "wrong hint");
        req(!passes(h, 0, hint(0, 3)), "hint out of range");
        req(!passes(h, 0, hint(0, 255)), "hint 255");
        req(!passes(h, 0), "no witness");
        req(!passes(h, 0, wit(0, hex"0002aa")), "hint of the wrong length");
        req(!passes(h, 0, wit(0, "")), "empty hint");
    }

    function test_kofn_truth_table() public {
        for (uint256 mask; mask < 8; ++mask) {
            uint256 yes = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
            bytes memory x = mask & 1 != 0 ? T() : F();
            bytes memory y = mask & 2 != 0 ? T() : F();
            bytes memory z = mask & 4 != 0 ? T() : F();
            for (uint8 k = 1; k <= 3; ++k) {
                req(passes(deploy(one(RuleSetCodec.kofn(k, k3(x, y, z)))), 0) == (yes >= k), "k-of-n");
            }
        }
    }

    function test_exactly_k_truth_table() public {
        for (uint256 mask; mask < 8; ++mask) {
            uint256 yes = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
            bytes memory x = mask & 1 != 0 ? T() : F();
            bytes memory y = mask & 2 != 0 ? T() : F();
            bytes memory z = mask & 4 != 0 ? T() : F();
            for (uint8 k = 1; k <= 3; ++k) {
                req(passes(deploy(one(RuleSetCodec.exactly(k, k3(x, y, z)))), 0) == (yes == k), "exactly k");
            }
        }
    }

    /// Exactly one of (true, unknown): the unknown could be a second yes, so the answer is unknown, never true; and NOT of
    /// it is not true either. Exactly one of (true, true, unknown) is a definite no (already two).
    function test_exactly_one_with_unknown_child_never_fires() public {
        bytes memory bad = RuleSetCodec.cmp(RuleSetCodec.srcGetter(address(new MockReverter()), g.value.selector, 20_000), OP_GE, 0);
        req(!passes(deploy(one(RuleSetCodec.exactly(1, k2(T(), bad)))), 0), "exactly one (yes, unknown): not true");
        req(!passes(deploy(one(RuleSetCodec.not_(RuleSetCodec.exactly(1, k2(T(), bad))))), 0), "NOT of unknown: not true");
        req(passes(deploy(one(RuleSetCodec.not_(RuleSetCodec.exactly(1, k3(T(), T(), bad))))), 0), "two yes already: exactly one is a definite no");
        req(passes(deploy(one(RuleSetCodec.exactly(1, k3(T(), F(), F())))), 0), "one yes, two definite no");
    }

    function test_nested_tree_from_values() public {
        // (value > 10 AND (paused OR other < 5)) AND NOT(2-of-3 of [value > 100, other > 100, paused])
        bytes memory paused = RuleSetCodec.cmp(RuleSetCodec.srcGetter(address(g), g.paused.selector, GAS), OP_EQ, 1);
        bytes memory other = RuleSetCodec.cmp(RuleSetCodec.srcGetter(address(g), g.other.selector, GAS), OP_LT, 5);
        bytes memory big = RuleSetCodec.cmp(RuleSetCodec.srcGetter(address(g), g.other.selector, GAS), OP_GT, 100);
        bytes memory tree = RuleSetCodec.and_(k3(cmpV(OP_GT, 10), RuleSetCodec.or_(k2(paused, other)), RuleSetCodec.not_(RuleSetCodec.kofn(2, k3(cmpV(OP_GT, 100), big, paused)))));
        // ids: 0 AND, 1 value>10, 2 OR, 3 paused, 4 other<5, 5 NOT, 6 kofn, 7,8,9 leaves
        CoreHarness h = deploy(one(tree));
        g.setValue(50);
        g.setOther(1);
        req(passes(h, 0, hint(2, 1)), "50 > 10, other < 5 (hint 1), not 2-of-3");
        req(!passes(h, 0, hint(2, 0)), "wrong hint (paused false)");
        g.setPaused(true);
        req(passes(h, 0, hint(2, 0)), "paused (hint 0)");
        g.setValue(200); // value > 100 and paused: 2 of 3 -> NOT false
        req(!passes(h, 0, hint(2, 0)), "2-of-3 true -> NOT false");
    }

    function test_witness_layout_is_validated() public {
        bytes memory tree = RuleSetCodec.or_(k2(F(), T()));
        CoreHarness h = deploy(one(tree));
        bytes memory good = hint(0, 1);
        req(passes(h, 0, good), "good");
        req(!passes(h, 0, bytes.concat(good, hex"00")), "trailing byte");
        req(!passes(h, 0, hex"000000"), "truncated header");
        req(!passes(h, 0, hex"0000000501"), "length past the end");
        req(!passes(h, 0, bytes.concat(hint(1, 0), hint(0, 1))), "ids not ascending");
        req(!passes(h, 0, bytes.concat(hint(0, 1), hint(0, 1))), "duplicate id");
        req(!passes(h, 0, bytes.concat(good, hint(3, 0))), "id beyond the node count");
        // an unused entry for a leaf is harmless
        req(passes(h, 0, bytes.concat(good, wit(1, hex"aabb"))), "extra entry for a leaf");
    }

    // ================================================================ rules, modes, keys

    function test_independent_mode_each_rule_alone() public {
        CoreHarness h = deploy(rules3(0, cmpV(OP_GT, 10), cmpV(OP_GT, 20), cmpV(OP_GT, 30), 1));
        g.setValue(25);
        req(passes(h, 0) && passes(h, 1) && !passes(h, 2), "0 and 1 true");
        req(!passes(h, 3), "no rule 3");
    }

    function test_else_mode_needs_earlier_trees_definitely_false() public {
        // rule 0: value > 100, rule 1: value > 10, rule 2: always (the default branch)
        CoreHarness h = deploy(rules3(1, cmpV(OP_GT, 100), cmpV(OP_GT, 10), T(), 1));
        g.setValue(500);
        req(passes(h, 0) && !passes(h, 1) && !passes(h, 2), "only the first matching rule");
        g.setValue(50);
        req(!passes(h, 0) && passes(h, 1) && !passes(h, 2), "second");
        g.setValue(5);
        req(!passes(h, 0) && !passes(h, 1) && passes(h, 2), "default");
    }

    function test_else_mode_costs_more_than_independent() public {
        bytes memory a = RuleSetCodec.and_(k2(cmpV(OP_LT, 1), cmpV(OP_LT, 1)));
        g.setValue(5); // a is false in both modes (short-circuits at the first leaf)
        CoreHarness ind = deploy(rules3(0, a, a, cmpV(OP_GT, 1), 0));
        CoreHarness els = deploy(rules3(1, a, a, cmpV(OP_GT, 1), 0));
        uint256 g0 = gasleft();
        req(passes(ind, 2), "independent");
        uint256 gi = g0 - gasleft();
        g0 = gasleft();
        req(passes(els, 2), "else");
        uint256 ge = g0 - gasleft();
        req(ge > gi, "else evaluates the earlier trees");
    }

    function test_max_fires_and_key_advance() public {
        CoreHarness h = deploy(rules3(0, T(), T(), T(), 1));
        (, uint256 k0) = h.nonceKey(args(0));
        (, uint256 k1) = h.nonceKey(args(1));
        req(k0 != k1 && k0 != 0, "keys differ per rule");
        req(fires(h, 0, ""), "rule 0 fires");
        req(h.usedKey(k0), "key consumed");
        (, uint256 k0b) = h.nonceKey(args(0));
        req(k0b != k0, "epoch advanced: a new key");
        req(!passes(h, 0), "maxFires 1: rule 0 is closed");
        req(!fires(h, 0, ""), "second trigger of the same event refused");
        req(fires(h, 1, "") && fires(h, 2, ""), "the other rules still fire once each");
        req(!fires(h, 1, "") && !fires(h, 2, ""), "and not twice");
        req(h.load(bytes32(uint256(keccak256("popcorn.ruleset.epoch")) + 0)) & type(uint128).max == 1, "epoch 1");
    }

    function test_unlimited_rule_rearms_with_a_new_key() public {
        CoreHarness h = deploy(one(T()));
        req(fires(h, 0, "") && fires(h, 0, "") && fires(h, 0, ""), "level-triggered unlimited rule fires every epoch");
        req(h.load(bytes32(uint256(keccak256("popcorn.ruleset.epoch")))) & type(uint128).max == 3, "epoch 3");
    }

    // ================================================================ actions

    function _callRule(bytes memory tree, address target, uint256 value, bytes memory data, uint32 gas_, uint16 maxFires) internal pure returns (bytes memory) {
        RuleSetCodec.Rule[] memory r = new RuleSetCodec.Rule[](1);
        r[0] = RuleSetCodec.rule(tree, maxFires, ACTION_CALL, RuleSetCodec.actionCall(target, value, data), gas_);
        return RuleSetCodec.encode(0, r);
    }

    function test_call_action_runs_with_value_and_never_reverts() public {
        CoreHarness h = deploy(_callRule(T(), address(g), 0.1 ether, abi.encodeCall(g.ping, (42)), 100_000, 1));
        req(fires(h, 0, ""), "fires");
        req(g.pings() == 1 && g.lastArg() == 42 && g.received() == 0.1 ether, "call delivered");
        // a reverting target: the action returns, the epoch advanced, nothing reverts
        CoreHarness h2 = deploy(_callRule(T(), address(new MockReverter()), 0, hex"12345678", 50_000, 1));
        req(fires(h2, 0, ""), "trigger with a reverting target is still a normal trigger");
        req(h2.load(bytes32(uint256(keccak256("popcorn.ruleset.epoch")))) & type(uint128).max == 1, "epoch advanced first");
        // a burner target is cut at the action's gas cap
        CoreHarness h3 = deploy(_callRule(T(), address(new MockBurner()), 0, hex"12345678", 30_000, 1));
        uint256 before = gasleft();
        req(fires(h3, 0, ""), "burner target");
        req(before - gasleft() < 150_000 && before - gasleft() > 30_000, "bounded by the action's gas cap");
        // value larger than the balance: the call fails, the trigger does not
        CoreHarness h4 = deploy(_callRule(T(), address(g), 100 ether, abi.encodeCall(g.ping, (1)), 100_000, 1));
        req(fires(h4, 0, ""), "insufficient value is a failed call, not a revert");
        req(g.pings() == 1, "nothing delivered by h4");
    }

    function test_checkpoint_updates_only_for_the_fired_rules_tree() public {
        RuleSetCodec.Rule[] memory r = new RuleSetCodec.Rule[](2);
        r[0] = RuleSetCodec.rule(RuleSetCodec.crossing(gv(), 100, DIR_UP, 0, 1), 0, ACTION_NONE, "", 0);
        r[1] = RuleSetCodec.rule(RuleSetCodec.delta(gv(), 100, DIR_UP, 1, 2), 0, ACTION_NONE, "", 0);
        CoreHarness h = deploy(RuleSetCodec.encode(0, r));
        g.setValue(150);
        req(fires(h, 0, ""), "rule 0");
        bytes32 base = bytes32(uint256(keccak256("popcorn.ruleset.checkpoint")));
        req(h.load(bytes32(uint256(base) + 1)) == 151, "slot 1 written");
        req(h.load(bytes32(uint256(base) + 2)) == 0, "slot 2 untouched");
    }

    // ================================================================ M1: action gas, retry on failure

    function _callRuleRetry(address target, bytes memory data, uint32 gas_, uint16 maxFires, bool retry) internal pure returns (bytes memory) {
        RuleSetCodec.Rule[] memory r = new RuleSetCodec.Rule[](1);
        r[0] = RuleSetCodec.rule(T(), maxFires, ACTION_CALL, RuleSetCodec.actionCall(target, 0, data), gas_);
        if (retry) r[0] = RuleSetCodec.withRetry(r[0]);
        return RuleSetCodec.encode(0, r);
    }

    function _word0(CoreHarness h) internal view returns (uint256) {
        return h.load(bytes32(uint256(keccak256("popcorn.ruleset.epoch"))));
    }

    function test_call_gas_is_capped_to_what_the_frame_can_afford_so_the_action_never_runs_dry() public {
        // configured gas 16,777,216 (the validator's maximum) against a burning callee and a frame of 400k
        CoreHarness h = deploy(_callRuleRetry(address(new MockBurner()), hex"12345678", 16_777_216, 1, false));
        (bool ok,) = address(h).call{gas: 400_000}(abi.encodeCall(h.pop, (args(0), "")));
        req(ok, "trigger returns");
        req(_word0(h) == 1 + (uint256(1) << 128), "the action finished: epoch and fires written despite the burning callee");
        // a frame with too little gas to call and finish skips the call instead of reverting
        CoreHarness h2 = deploy(_callRuleRetry(address(g), abi.encodeCall(g.ping, (1)), 100_000, 1, false));
        uint256 pings0 = g.pings();
        (ok,) = address(h2).call{gas: 90_000}(abi.encodeCall(h2.pop, (args(0), "")));
        req(_word0(h2) & type(uint128).max == 1 || !ok, "epoch advanced, or the whole low-gas trigger never started");
        req(g.pings() == pings0, "no call with 90k: the action skipped it");
    }

    function test_failed_call_counts_unless_the_rule_retries() public {
        MockToggle t = new MockToggle();
        t.setFailing(true);
        bytes memory data = abi.encodeCall(t.act, ());
        // no retry: the failing trigger uses the rule up (the epoch advanced, the fire counted)
        CoreHarness h = deploy(_callRuleRetry(address(t), data, 100_000, 1, false));
        req(fires(h, 0, ""), "trigger included");
        req(_word0(h) == 1 + (uint256(1) << 128), "epoch 1, fires 1");
        req(!passes(h, 0), "closed: a triggerer timed a trigger for when the callee was down");
        // retry: the failed call advances the epoch (fresh key) but does not count
        CoreHarness r = deploy(_callRuleRetry(address(t), data, 100_000, 1, true));
        (, uint256 k0) = r.nonceKey(args(0));
        req(fires(r, 0, ""), "failing trigger");
        (, uint256 k1) = r.nonceKey(args(0));
        req(k0 != k1, "fresh key");
        req(_word0(r) == 1, "epoch 1, fires 0");
        req(passes(r, 0), "still open");
        t.setFailing(false);
        req(fires(r, 0, ""), "successful retry");
        req(t.count() == 1, "the call ran once");
        req(_word0(r) == 2 + (uint256(1) << 128), "epoch 2, fires 1");
        req(!passes(r, 0), "closed after the successful fire");
        // debug view reports fires
        RuleSet.RuleDebug memory d = _debug(r, 0, args(0), "");
        req(d.epoch == 2 && d.fires == 1 && d.exhausted, "debug: epoch, fires, exhausted");
    }

    function test_validator_bounds_the_action_gas_and_the_retry_byte() public {
        RuleSetCodec.Rule[] memory r = new RuleSetCodec.Rule[](1);
        r[0] = RuleSetCodec.rule(T(), 0, ACTION_CALL, RuleSetCodec.actionCall(address(g), 0, ""), 16_777_216);
        req(validates(RuleSetCodec.encode(0, r)), "gas at the bound");
        r[0] = RuleSetCodec.rule(T(), 0, ACTION_CALL, RuleSetCodec.actionCall(address(g), 0, ""), 16_777_217);
        req(!validates(RuleSetCodec.encode(0, r)), "gas over the per-frame bound");
        bytes memory ok_ = _callRuleRetry(address(g), "", 50_000, 1, true);
        bytes memory bad = bytes.concat(ok_);
        bad[CONFIG_HEADER + 7] = 0x02;
        req(validates(ok_) && !validates(bad), "retry byte must be 0 or 1");
    }

    // ================================================================ external predicate

    function test_predicate_witness_context_and_sender() public {
        MockSigner p = new MockSigner();
        bytes memory good = "signature-bytes";
        // params: witness hash, context hash (0 = any), rule contract (0 = any)
        CoreHarness any = deploy(one(RuleSetCodec.predicate(address(p), 30_000, abi.encode(keccak256(good), bytes32(0), address(0)))));
        req(passes(any, 0, wit(0, good)), "valid witness");
        req(!passes(any, 0, wit(0, "other")), "wrong witness");
        req(!passes(any, 0), "no witness entry: the predicate is not called");
        // context binds (ruleId, epoch, keccak256(popArgs)); the rule contract is msg.sender
        // (the harness is the rule contract: build the config knowing its address by deploying in two steps is not possible, so
        // check the context through a predicate that accepts any rule contract)
        bytes32 ctxHash = keccak256(abi.encode(uint256(0), uint256(0), keccak256(args(0))));
        CoreHarness bound = deploy(one(RuleSetCodec.predicate(address(p), 30_000, abi.encode(keccak256(good), ctxHash, address(0)))));
        req(passes(bound, 0, wit(0, good)), "context for rule 0, epoch 0, these popArgs");
        // different popArgs (extra byte) change the context: refused
        req(!bound.condition(bytes.concat(args(0), hex"01"), wit(0, good)), "other popArgs -> other context");
        // after the rule fired once (epoch 1) the old signature's context no longer matches
        req(fires(bound, 0, wit(0, good)), "fires");
        req(!passes(bound, 0, wit(0, good)), "epoch 1: a signature for epoch 0 is stale");
        // msg.sender binding: a predicate that expects another rule contract
        CoreHarness wrongRule = deploy(one(RuleSetCodec.predicate(address(p), 30_000, abi.encode(keccak256(good), bytes32(0), address(0x1234)))));
        req(!passes(wrongRule, 0, wit(0, good)), "msg.sender is the rule contract");
        // a predicate that reverts / burns gas / is no contract is false (fail closed)
        CoreHarness rev = deploy(one(RuleSetCodec.predicate(address(new MockReverter()), 30_000, "")));
        CoreHarness burn = deploy(one(RuleSetCodec.predicate(address(new MockBurner()), 30_000, "")));
        CoreHarness none = deploy(one(RuleSetCodec.predicate(address(0xDEAD), 30_000, "")));
        req(!passes(rev, 0, wit(0, "x")) && !passes(burn, 0, wit(0, "x")) && !passes(none, 0, wit(0, "x")), "broken predicates are false");
    }

    // ================================================================ debug view

    function test_debug_view_reports_each_node() public {
        // 0 AND, 1 value > 10, 2 OR, 3 paused, 4 other < 5
        bytes memory paused = RuleSetCodec.cmp(RuleSetCodec.srcGetter(address(g), g.paused.selector, GAS), OP_EQ, 1);
        bytes memory other = RuleSetCodec.cmp(RuleSetCodec.srcGetter(address(g), g.other.selector, GAS), OP_LT, 5);
        CoreHarness h = deploy(one(RuleSetCodec.and_(k2(cmpV(OP_GT, 10), RuleSetCodec.or_(k2(paused, other))))));
        g.setValue(50);
        g.setOther(9);
        RuleSet.RuleDebug memory d = _debug(h, 0, args(0), "");
        req(d.ruleExists && d.witnessOk && !d.wouldPass, "fails");
        req(d.nodes.length == 5, "5 nodes");
        req(uint8(d.nodes[0]) == 0 && uint8(d.nodes[1]) == 1 && uint8(d.nodes[2]) == 0 && uint8(d.nodes[3]) == 0 && uint8(d.nodes[4]) == 0, "per-node results: the OR is false because both children are");
        g.setPaused(true);
        d = _debug(h, 0, args(0), hint(2, 0));
        req(d.wouldPass, "passes with the hint");
        req(uint8(d.nodes[3]) == 1 && uint8(d.nodes[4]) == 0 && uint8(d.nodes[2]) == 1 && uint8(d.nodes[0]) == 1, "paused true");
        d = _debug(h, 0, args(0), hint(2, 1));
        req(!d.wouldPass, "the same state with the wrong hint does not pass");
        req(uint8(d.nodes[2]) == 1, "but the debug view shows the OR is true: the hint is the problem");
        d = _debug(h, 7, args(7), "");
        req(!d.ruleExists, "unknown rule");
    }

    function test_debug_view_is_read_only_and_not_a_way_to_the_hooks() public {
        CoreHarness h = deploy(one(T()));
        // the debug call is a view: it changes nothing even when it reports a passing trigger
        RuleSet.RuleDebug memory d = _debug(h, 0, args(0), "");
        req(d.wouldPass, "passes");
        req(h.load(bytes32(uint256(keccak256("popcorn.ruleset.epoch")))) & type(uint128).max == 0, "no epoch change");
        // the reserved hooks stay out of reach of a forwarded call: they are Core's (0x38); the harness models that, and the
        // logic's own guard refuses a direct call
        RuleSetContract l = RuleSetContract(h.logic());
        bool reverted;
        try l.popcornDebug(0, args(0), "") {} catch {
            reverted = true;
        }
        req(reverted, "forwarded modifier: a direct call on the logic reverts");
    }

    function _debug(CoreHarness h, uint256 ruleId, bytes memory popArgs, bytes memory w_) internal returns (RuleSet.RuleDebug memory d) {
        (bool ok, bytes memory ret) = address(h).call(abi.encodeCall(RuleSet.popcornDebug, (ruleId, popArgs, w_)));
        require(ok, "debug call failed");
        d = abi.decode(ret, (RuleSet.RuleDebug));
    }

    // ================================================================ util

    function _s(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 n;
        for (uint256 t = v; t != 0; t /= 10) ++n;
        bytes memory b = new bytes(n);
        for (uint256 t = v; t != 0; t /= 10) b[--n] = bytes1(uint8(48 + (t % 10)));
        return string(b);
    }
}
