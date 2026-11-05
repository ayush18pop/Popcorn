// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreHarness} from "test/CoreHarness.sol";
import {RuleSetContract} from "src/rules/RuleSetContract.sol";
import {RuleSet} from "src/rules/RuleSet.sol";
import "src/rules/RuleSetCodec.sol";
import {MockReverter} from "src/mocks/RuleSetMocks.sol";

/// Random trees over {true, false, unreadable} leaves checked against an independent tri-state (Kleene) reference.
/// Property: with the best hints, condition() == (reference(root) == 1); else mode: rule j passes iff trees 0..j-1 are
/// definitely false and tree j is true; the debug view reports the reference value for every node.
contract RuleSetFuzzTest {
    struct M {
        uint8 t; // 0 leaf, 1 AND, 2 OR, 3 NOT, 4 KOFN
        uint8 k;
        uint8 leaf; // 0 false, 1 true, 2 unreadable
        uint256[] kids;
    }

    struct G {
        M[] ms;
        uint256 n;
        uint256 rng;
    }

    address internal immutable bad = address(new MockReverter());

    function _rand(G memory g, uint256 mod) internal pure returns (uint256 r) {
        g.rng = uint256(keccak256(abi.encode(g.rng)));
        r = g.rng % mod;
    }

    function _gen(G memory g, uint256 depth) internal pure returns (uint256 idx) {
        idx = g.n++;
        uint256 kind = depth >= 4 || g.n > 40 ? 0 : _rand(g, 6);
        if (kind <= 1) {
            g.ms[idx].t = 0;
            g.ms[idx].leaf = uint8(_rand(g, 3));
            return idx;
        }
        if (kind == 2 || kind == 3 || kind == 5) {
            g.ms[idx].t = kind == 2 ? 1 : (kind == 3 ? 2 : 4);
            uint256 n = 1 + _rand(g, 4);
            g.ms[idx].kids = new uint256[](n);
            if (kind == 5) g.ms[idx].k = uint8(1 + _rand(g, n));
        } else {
            g.ms[idx].t = 3;
            g.ms[idx].kids = new uint256[](1);
        }
        for (uint256 i; i < g.ms[idx].kids.length; ++i) g.ms[idx].kids[i] = _gen(g, depth + 1);
    }

    function _ref(M[] memory ms, uint256 i) internal pure returns (uint256) {
        M memory m = ms[i];
        if (m.t == 0) return m.leaf;
        if (m.t == 3) {
            uint256 r = _ref(ms, m.kids[0]);
            return r == 2 ? 2 : 1 - r;
        }
        uint256 yes;
        uint256 unk;
        uint256 no;
        for (uint256 j; j < m.kids.length; ++j) {
            uint256 r = _ref(ms, m.kids[j]);
            if (r == 1) ++yes;
            else if (r == 2) ++unk;
            else ++no;
        }
        if (m.t == 1) return no > 0 ? 0 : (unk > 0 ? 2 : 1);
        if (m.t == 2) return yes > 0 ? 1 : (unk > 0 ? 2 : 0);
        return yes >= m.k ? 1 : (yes + unk >= m.k ? 2 : 0);
    }

    function _enc(M[] memory ms, uint256 i) internal view returns (bytes memory) {
        M memory m = ms[i];
        if (m.t == 0) {
            if (m.leaf == 2) return RuleSetCodec.cmp(RuleSetCodec.srcGetter(bad, bytes4(0x3fa4f245), 20_000), OP_GE, 0);
            return RuleSetCodec.constant_(m.leaf == 1);
        }
        bytes[] memory kids = new bytes[](m.kids.length);
        for (uint256 j; j < kids.length; ++j) kids[j] = _enc(ms, m.kids[j]);
        if (m.t == 1) return RuleSetCodec.and_(kids);
        if (m.t == 2) return RuleSetCodec.or_(kids);
        if (m.t == 3) return RuleSetCodec.not_(kids[0]);
        return RuleSetCodec.kofn(m.k, kids);
    }

    /// witness: one hint entry per OR node (global id = base + preorder position), pointing at the first true child
    function _hints(M[] memory ms, uint256 n, uint256 base) internal pure returns (bytes memory out) {
        for (uint256 i; i < n; ++i) {
            if (ms[i].t != 2) continue;
            uint8 idx;
            for (uint256 j; j < ms[i].kids.length; ++j) {
                if (_ref(ms, ms[i].kids[j]) == 1) {
                    idx = uint8(j);
                    break;
                }
            }
            out = bytes.concat(out, abi.encodePacked(uint16(base + i), uint16(1), idx));
        }
    }

    function _tree(uint256 seed) internal view returns (M[] memory ms, uint256 n, bytes memory enc) {
        G memory g;
        g.ms = new M[](64);
        g.rng = seed;
        _gen(g, 0);
        ms = g.ms;
        n = g.n;
        enc = _enc(ms, 0);
        // preorder generation: node i's index IS its preorder position
    }

    function testFuzz_independent_matches_reference(uint256 seed) public {
        (M[] memory ms, uint256 n, bytes memory enc) = _tree(seed);
        RuleSetCodec.Rule[] memory r = new RuleSetCodec.Rule[](1);
        r[0] = RuleSetCodec.rule(enc, 0, ACTION_NONE, "", 0);
        RuleSetContract l = new RuleSetContract(RuleSetCodec.encode(0, r), 0);
        CoreHarness h = new CoreHarness(address(l), 600_000);
        bool want = _ref(ms, 0) == 1;
        require(h.condition(abi.encode(uint256(0)), _hints(ms, n, 0)) == want, "condition != reference");
        // no hints at all: a tree with an OR can only be false-or-true-without-needing-it, never MORE true than the reference
        if (!want) require(!h.condition(abi.encode(uint256(0)), ""), "no hints made a false tree true");
        // the debug view reports the reference value of every node
        (bool ok, bytes memory ret) = address(h).call(abi.encodeCall(RuleSet.popcornDebug, (0, abi.encode(uint256(0)), _hints(ms, n, 0))));
        require(ok, "debug");
        RuleSet.RuleDebug memory d = abi.decode(ret, (RuleSet.RuleDebug));
        require(d.wouldPass == want && d.nodes.length == n, "debug summary");
        for (uint256 i; i < n; ++i) require(uint8(d.nodes[i]) == _ref(ms, i), "debug node != reference");
    }

    function testFuzz_else_mode_matches_reference(uint256 seed) public {
        G memory ga;
        ga.ms = new M[](64);
        ga.rng = seed;
        uint256 nr = 3;
        M[][] memory trees = new M[][](nr);
        uint256[] memory counts = new uint256[](nr);
        RuleSetCodec.Rule[] memory r = new RuleSetCodec.Rule[](nr);
        bytes memory wit;
        uint256 base;
        for (uint256 i; i < nr; ++i) {
            G memory g;
            g.ms = new M[](64);
            g.rng = uint256(keccak256(abi.encode(seed, i)));
            _gen(g, 2); // shallower trees: 3 of them must fit 64 nodes
            trees[i] = g.ms;
            counts[i] = g.n;
            r[i] = RuleSetCodec.rule(_enc(g.ms, 0), 0, ACTION_NONE, "", 0);
            wit = bytes.concat(wit, _hints(g.ms, g.n, base));
            base += g.n;
        }
        if (base > MAX_NODES) return; // over the bound: not a valid config (rejected by the validator, tested elsewhere)
        RuleSetContract l = new RuleSetContract(RuleSetCodec.encode(1, r), 0);
        CoreHarness h = new CoreHarness(address(l), 900_000);
        for (uint256 j; j < nr; ++j) {
            bool want = _ref(trees[j], 0) == 1;
            for (uint256 i; i < j; ++i) if (_ref(trees[i], 0) != 0) want = false;
            require(h.condition(abi.encode(j), wit) == want, "else-mode condition != reference");
        }
        // independent mode over the same trees: each rule on its own
        RuleSetContract l2 = new RuleSetContract(RuleSetCodec.encode(0, r), 0);
        CoreHarness h2 = new CoreHarness(address(l2), 900_000);
        for (uint256 j; j < nr; ++j) require(h2.condition(abi.encode(j), wit) == (_ref(trees[j], 0) == 1), "independent condition != reference");
    }
}
