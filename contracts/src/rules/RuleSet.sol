// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {ICondition} from "src/interfaces/ICondition.sol";
import "src/rules/RuleSetCodec.sol";

/// @dev 512-bit product of two uint256 (hi, lo): overflow-safe comparisons without division.
function mul512(uint256 x, uint256 y) pure returns (uint256 hi, uint256 lo) {
    assembly ("memory-safe") {
        let mm := mulmod(x, y, not(0))
        lo := mul(x, y)
        hi := sub(sub(mm, lo), lt(mm, lo))
    }
}

/// @dev compares x1*y1 with x2*y2 exactly: -1, 0, 1 as 0, 1, 2 (less, equal, greater).
function cmpProducts(uint256 x1, uint256 y1, uint256 x2, uint256 y2) pure returns (uint256) {
    (uint256 h1, uint256 l1) = mul512(x1, y1);
    (uint256 h2, uint256 l2) = mul512(x2, y2);
    if (h1 != h2) return h1 < h2 ? 0 : 2;
    if (l1 != l2) return l1 < l2 ? 0 : 2;
    return 1;
}

function opHolds(uint256 c, uint256 op) pure returns (bool) {
    // c: 0 less, 1 equal, 2 greater
    if (op == OP_GT) return c == 2;
    if (op == OP_GE) return c >= 1;
    if (op == OP_LT) return c == 0;
    if (op == OP_LE) return c <= 1;
    if (op == OP_EQ) return c == 1;
    return c != 1; // OP_NE
}

/// @title RuleSet
/// @notice Abstract rule contract logic that evaluates a rule-set config (RuleSetCodec) in VERIFY and runs the named rule's action.
///         Concrete logics supply the config (`_ruleSetConfig`, validated once by the constructor with `RuleSetCodec.validate`)
///         and may override `_runAction`. RuleSetContract is the data-driven one (the SDK builds the config, no Solidity).
///
///         A trigger names its rule: popArgs = abi.encode(ruleId) (more bytes allowed; they only change the predicate context).
///         verifyData = the witness (entries per node id, see RuleSetCodec). Nonce key = keccak(KEY_DOMAIN, ruleId, epoch[ruleId]);
///         the action advances the epoch FIRST, so the key moves forward whatever else the action does.
///         `maxFires` (per rule, 0 = unlimited) closes a rule once it has FIRED that many times: the condition is false from then on.
///         A rule's storage word is `epoch | fires << 128` (one slot). The epoch advances on every trigger (fresh key); `fires` counts
///         triggers that count. A CALL action that fails counts unless the rule has `retry` set (then the rule stays open and can be
///         triggered again with the fresh key). Retry means a callee that keeps failing lets anyone keep making the rule contract pay for
///         triggers while the condition is true (bounded by the rule contract's balance); without retry a callee that is down at the moment
///         of the trigger uses the rule up. Several CALL values compete for the rule contract's balance and the triggerer picks the order.
///
///         ACTION GAS. The CALL's gas is min(configured cap, gasleft() - ACTION_RESERVE) so the epoch write, the event and the
///         return always have gas left (the key is consumed at APPROVE: a reverting action would brick the rule). An overriding
///         `_runAction` must stay inside maxGasPerFrame and maxStateGasPerFrame the same way: every fresh storage slot it writes
///         costs 97,920 state gas on top of the epoch slot (the SDK planner cannot know it).
///
///         Modes. 0 independent: rule i fires when its tree is true. 1 else: rule i fires when its tree is true AND every
///         earlier tree is definitely false.
///
///         Fail closed, and what "false" means. A leaf that cannot be read (revert, out of its gas cap, short return) is
///         UNKNOWN, not false. A tri-state (0 false, 1 true, 2 unknown) is carried through NOT / else so that a broken or
///         gas-starved read can never turn into a true result through negation. Where only "true" is trusted (the rule's own
///         tree, evaluated monotonically) unknown collapses to false, and OR trusts the triggerer's hint (the child index in the
///         witness) because a wrong hint can only make the result false. Where the exact value is needed (under NOT, and the
///         earlier trees of an else set) OR ignores the hint and evaluates every child. A predicate leaf cannot be exact (its
///         false is "the witness failed"), so the validator refuses it under NOT and in the earlier trees of an else set.
abstract contract RuleSet is RuleContract {
    bytes32 internal constant EPOCH_BASE = keccak256("popcorn.ruleset.epoch");
    bytes32 internal constant CKPT_BASE = keccak256("popcorn.ruleset.checkpoint");
    bytes32 internal constant KEY_DOMAIN = keccak256("popcorn.ruleset.key");
    uint256 internal constant HALF = 1 << 255;
    uint256 internal constant EPOCH_MASK = type(uint128).max;
    /// @dev Gas kept back from a CALL action for the fires write, the RuleFired event and the return.
    uint256 internal constant ACTION_RESERVE = 30_000;

    event RuleFired(uint256 indexed ruleId, uint256 epoch, address payer, bool actionOk);

    struct Ev {
        bytes cfg;
        bytes wit;
        uint256 cur; // witness cursor (byte offset of the next unread entry)
        uint256 ruleId;
        uint256 epoch;
        bytes32 popHash;
        bytes ctx; // abi.encode(ruleId, epoch, popHash), built on first predicate use
        bytes dbg; // debug: one result byte per node id (0xff = not evaluated)
        bool debug;
    }

    struct RuleDebug {
        bool ruleExists;
        bool exhausted; // fires reached maxFires
        bool witnessOk; // the witness is well formed
        bool wouldPass; // the exact answer the rule contract's condition gives for these inputs
        uint256 epoch;
        uint256 fires; // fires that counted toward maxFires
        uint256 nonceKey;
        uint256 maxFires;
        uint256 mode;
        uint256 firstNodeId;
        bytes earlier; // else mode: tri-state of trees 0..ruleId-1 (0 false, 1 true, 2 unknown); empty otherwise
        bytes nodes; // tri-state of every node of the rule's tree, preorder, evaluated in full (no short-circuit, no hint); 0xff = not evaluated
    }

    /// @notice The validated config bytes. Called in every VERIFY, so keep it cheap (RuleSetContract: one EXTCODECOPY).
    function _ruleSetConfig() internal view virtual returns (bytes memory);

    // ------------------------------------------------------------------ hooks

    function nonceKey(bytes calldata popArgs) internal view virtual override returns (uint256) {
        uint256 ruleId = _word(popArgs, 0);
        return uint256(keccak256(abi.encode(KEY_DOMAIN, ruleId, _sload(bytes32(uint256(EPOCH_BASE) + ruleId)) & EPOCH_MASK)));
    }

    function condition(bytes calldata popArgs, bytes calldata verifyData) internal view virtual override returns (bool) {
        return _passes(_word(popArgs, 0), popArgs, verifyData);
    }

    function action(bytes calldata popArgs, address payer_) internal virtual override {
        uint256 ruleId = _word(popArgs, 0);
        bytes32 es = bytes32(uint256(EPOCH_BASE) + ruleId);
        uint256 word = _sload(es);
        uint256 epoch = word & EPOCH_MASK;
        uint256 fires = word >> 128;
        _sstore(es, (fires << 128) | (epoch + 1)); // first: the next trigger of this rule uses a fresh key
        bytes memory cfg = _ruleSetConfig();
        if (ruleId >= u8(cfg, 2)) return;
        _updateCheckpoints(cfg, ruleId);
        bool ok = _runAction(ruleId, epoch, popArgs, payer_, cfg);
        // a failed CALL counts as a fire unless the rule retries on failure
        if (ok || u8(cfg, CONFIG_HEADER + RULE_RECORD * ruleId + 7) == 0) _sstore(es, ((fires + 1) << 128) | (epoch + 1));
        emit RuleFired(ruleId, epoch, payer_, ok);
    }

    /// @notice What a fired rule does. Default: the rule's configured action (NONE, or a CALL with its gas cap whose
    ///         failure is reported, never reverted). Override for Solidity actions; it must not revert for reasons a triggerer
    ///         or payer controls and returns whether the action succeeded.
    function _runAction(uint256 ruleId, uint256, bytes calldata, address, bytes memory cfg) internal virtual returns (bool ok) {
        uint256 rec = CONFIG_HEADER + RULE_RECORD * ruleId;
        if (u8(cfg, rec + 6) != ACTION_CALL) return true;
        uint256 off = u16(cfg, rec + 8);
        uint256 len = u16(cfg, rec + 10);
        uint256 g = u32(cfg, rec + 12);
        uint256 avail = gasleft();
        if (avail <= ACTION_RESERVE + 10_000) return false; // too little left to call and still finish: skip the call, never revert
        if (g > avail - ACTION_RESERVE) g = avail - ACTION_RESERVE;
        address target = addrAt(cfg, off);
        uint256 value = w(cfg, off + 20);
        assembly ("memory-safe") {
            ok := call(g, target, value, add(add(cfg, 32), add(off, 52)), sub(len, 52), 0, 0)
        }
    }

    // ------------------------------------------------------------------ views (forwarded: callable through the rule contract)

    /// @notice How many triggers of rule `ruleId` ran (its epoch: the nonce key advances with it).
    function ruleEpoch(uint256 ruleId) external view forwarded returns (uint256) {
        return _sload(bytes32(uint256(EPOCH_BASE) + ruleId)) & EPOCH_MASK;
    }

    /// @notice How many triggers of rule `ruleId` counted toward its maxFires.
    function ruleFires(uint256 ruleId) external view forwarded returns (uint256) {
        return _sload(bytes32(uint256(EPOCH_BASE) + ruleId)) >> 128;
    }

    /// @notice The stored checkpoint of a crossing/delta slot (0 = none yet, else value + 1).
    function checkpoint(uint256 slotId) external view forwarded returns (uint256) {
        return _sload(bytes32(uint256(CKPT_BASE) + slotId));
    }

    /// @notice Per-node explanation for simulate() and the Studio: runs the rule's tree in full against the given inputs
    ///         and returns every node's tri-state, plus the exact answer the condition would give. Read-only (a `view`
    ///         running by DELEGATECALL from the rule contract's forward path: the compiler forbids storage writes, external calls
    ///         are STATICCALLs). It never runs an action, the owner path or a reserved selector.
    function popcornDebug(uint256 ruleId, bytes calldata popArgs, bytes calldata verifyData) external view forwarded returns (RuleDebug memory d) {
        bytes memory cfg = _ruleSetConfig();
        d.mode = u8(cfg, 1);
        d.ruleExists = ruleId < u8(cfg, 2);
        if (!d.ruleExists) return d;
        uint256 rec = CONFIG_HEADER + RULE_RECORD * ruleId;
        uint256 word = _sload(bytes32(uint256(EPOCH_BASE) + ruleId));
        d.epoch = word & EPOCH_MASK;
        d.fires = word >> 128;
        d.maxFires = u16(cfg, rec);
        d.exhausted = d.maxFires != 0 && d.fires >= d.maxFires;
        d.nonceKey = uint256(keccak256(abi.encode(KEY_DOMAIN, ruleId, d.epoch)));
        d.wouldPass = _passes(ruleId, popArgs, verifyData);
        Ev memory ev = _ev(cfg, ruleId, d.epoch, popArgs, verifyData);
        d.witnessOk = _witnessOk(ev.wit, u16(cfg, 3));
        if (!d.witnessOk) return d;
        if (d.mode == 1) {
            d.earlier = new bytes(ruleId);
            for (uint256 i; i < ruleId; ++i) d.earlier[i] = bytes1(uint8(_evalTree(ev, i, true)));
        }
        d.firstNodeId = u16(cfg, rec + 2);
        uint256 root = u16(cfg, rec + 4);
        uint256 count = u16(cfg, root + 3);
        ev.debug = true;
        ev.cur = 0;
        ev.dbg = new bytes(u16(cfg, 3));
        for (uint256 i; i < ev.dbg.length; ++i) ev.dbg[i] = 0xff;
        _eval(ev, root, d.firstNodeId, true);
        d.nodes = new bytes(count);
        for (uint256 i; i < count; ++i) d.nodes[i] = ev.dbg[d.firstNodeId + i];
    }

    // ------------------------------------------------------------------ condition

    function _ev(bytes memory cfg, uint256 ruleId, uint256 epoch, bytes calldata popArgs, bytes calldata verifyData) private pure returns (Ev memory ev) {
        ev.cfg = cfg;
        ev.wit = verifyData;
        ev.ruleId = ruleId;
        ev.epoch = epoch;
        ev.popHash = keccak256(popArgs);
    }

    function _passes(uint256 ruleId, bytes calldata popArgs, bytes calldata verifyData) internal view returns (bool) {
        bytes memory cfg = _ruleSetConfig();
        if (ruleId >= u8(cfg, 2)) return false;
        uint256 word = _sload(bytes32(uint256(EPOCH_BASE) + ruleId));
        uint256 epoch = word & EPOCH_MASK;
        uint256 maxFires = u16(cfg, CONFIG_HEADER + RULE_RECORD * ruleId);
        if (maxFires != 0 && (word >> 128) >= maxFires) return false;
        Ev memory ev = _ev(cfg, ruleId, epoch, popArgs, verifyData);
        if (!_witnessOk(ev.wit, u16(cfg, 3))) return false;
        if (u8(cfg, 1) == 1) {
            for (uint256 i; i < ruleId; ++i) {
                if (_evalTree(ev, i, true) != 0) return false; // else: every earlier tree must be DEFINITELY false
            }
        }
        return _evalTree(ev, ruleId, false) == 1;
    }

    /// @dev Entries (nodeId u16, len u16, data): in bounds, ids strictly ascending and below the node count, nothing trailing.
    function _witnessOk(bytes memory wb, uint256 nodeCount) private pure returns (bool) {
        uint256 n = wb.length;
        uint256 pos;
        uint256 prev = type(uint256).max;
        while (pos < n) {
            if (pos + 4 > n) return false;
            uint256 id = u16(wb, pos);
            uint256 l = u16(wb, pos + 2);
            if (pos + 4 + l > n || id >= nodeCount || (prev != type(uint256).max && id <= prev)) return false;
            prev = id;
            pos += 4 + l;
        }
        return true;
    }

    function _wit(Ev memory ev, uint256 id) private pure returns (bool found, uint256 pos, uint256 len) {
        bytes memory wb = ev.wit;
        uint256 cur = ev.cur;
        uint256 n = wb.length;
        while (cur < n) {
            uint256 eid = u16(wb, cur);
            uint256 l = u16(wb, cur + 2);
            if (eid < id) {
                cur += 4 + l;
                continue;
            }
            ev.cur = cur;
            if (eid == id) return (true, cur + 4, l);
            return (false, 0, 0);
        }
        ev.cur = cur;
    }

    function _evalTree(Ev memory ev, uint256 rule, bool exact) private view returns (uint256) {
        uint256 rec = CONFIG_HEADER + RULE_RECORD * rule;
        return _eval(ev, u16(ev.cfg, rec + 4), u16(ev.cfg, rec + 2), exact);
    }

    /// @dev 0 false, 1 true, 2 unknown. exact = false: only "true" is trusted, so unknown collapses to false.
    function _eval(Ev memory ev, uint256 p, uint256 id, bool exact) private view returns (uint256 r) {
        uint256 t = u8(ev.cfg, p);
        r = t < 0x10 ? _composite(ev, t, p, id, exact) : _leaf(ev, t, p, id, exact);
        if (ev.debug) ev.dbg[id] = bytes1(uint8(r));
        if (!exact && r == 2) r = 0;
    }

    function _composite(Ev memory ev, uint256 t, uint256 p, uint256 id, bool exact) private view returns (uint256) {
        uint256 end = p + u16(ev.cfg, p + 1);
        uint256 q = p + NODE_HEADER;
        if (t == T_NOT) {
            uint256 r = _eval(ev, q, id + 1, true); // the exact value of the child is needed
            return r == 2 ? 2 : 1 - r;
        }
        uint256 k;
        if (t == T_KOFN) {
            k = u8(ev.cfg, q);
            q += 1;
        }
        if (t == T_OR && !exact && !ev.debug) return _orHint(ev, q, end, id);
        uint256 tally = _tally(ev, t, q, end, id, exact, k);
        uint256 yes = tally & MASK64;
        uint256 unk = (tally >> 64) & MASK64;
        if (t == T_AND) return (tally >> 128) > 0 ? 0 : (unk > 0 ? 2 : 1);
        if (t == T_OR) return yes > 0 ? 1 : (unk > 0 ? 2 : 0);
        return yes >= k ? 1 : (yes + unk >= k ? 2 : 0); // KOFN
    }

    uint256 private constant MASK64 = type(uint64).max;

    /// @dev Evaluates children in order, stopping early unless debugging: AND at the first false, OR at the first true,
    ///      k-of-n once k are true. Returns yes | unknown << 64 | no << 128.
    function _tally(Ev memory ev, uint256 t, uint256 q, uint256 end, uint256 id, bool exact, uint256 k) private view returns (uint256 tally) {
        uint256 cid = id + 1;
        while (q < end) {
            uint256 r = _eval(ev, q, cid, exact);
            tally += uint256(1) << (r == 1 ? 0 : (r == 2 ? 64 : 128));
            if (!ev.debug) {
                if (t == T_AND && r == 0) return tally;
                if (t == T_OR && r == 1) return tally;
                if (t == T_KOFN && (tally & MASK64) >= k) return tally;
            }
            cid += u16(ev.cfg, q + 3);
            q += u16(ev.cfg, q + 1);
        }
    }

    function _orHint(Ev memory ev, uint256 q, uint256 end, uint256 id) private view returns (uint256) {
        (bool found, uint256 pos, uint256 len) = _wit(ev, id);
        if (!found || len != 1) return 0;
        uint256 j = u8(ev.wit, pos);
        bytes memory c = ev.cfg;
        uint256 cid = id + 1;
        for (uint256 i; q < end; ++i) {
            if (i == j) return _eval(ev, q, cid, false);
            cid += u16(c, q + 3);
            q += u16(c, q + 1);
        }
        return 0;
    }

    // ------------------------------------------------------------------ leaves

    function _leaf(Ev memory ev, uint256 t, uint256 p, uint256 id, bool exact) private view returns (uint256) {
        bytes memory c = ev.cfg;
        uint256 b = p + NODE_HEADER;
        if (t == T_CONST) return u8(c, b);
        if (t == T_CMP) {
            (bool ok, uint256 v) = _read(c, b);
            return ok ? (opHolds(_order(v, w(c, b + 65)), u8(c, b + 64)) ? 1 : 0) : 2;
        }
        if (t == T_RANGE) {
            (bool ok, uint256 v) = _read(c, b);
            if (!ok) return 2;
            bool inside = v >= w(c, b + 64) && v <= w(c, b + 96);
            return (u8(c, b + 128) == 1 ? !inside : inside) ? 1 : 0;
        }
        if (t == T_CROSSING) return _crossing(c, b);
        if (t == T_DELTA) return _delta(c, b);
        if (t == T_RATIO) return _ratio(c, b);
        if (t == T_CODEHASH) {
            bytes32 h;
            address a = addrAt(c, b);
            assembly ("memory-safe") {
                h := extcodehash(a)
            }
            bool same = uint256(h) == w(c, b + 20);
            return (u8(c, b + 52) == 1 ? same : !same) ? 1 : 0;
        }
        return _predicate(ev, p, id, exact); // T_PREDICATE (validated)
    }

    function _order(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? 0 : (a == b ? 1 : 2);
    }

    function _last(uint256 slotId, uint256 initial) private view returns (uint256) {
        uint256 s = _sload(bytes32(uint256(CKPT_BASE) + slotId));
        return s == 0 ? initial : s - 1;
    }

    function _crossing(bytes memory c, uint256 b) private view returns (uint256) {
        (bool ok, uint256 v) = _read(c, b);
        if (!ok || v >= HALF) return 2;
        uint256 line = w(c, b + 64);
        uint256 dir = u8(c, b + 96);
        uint256 last = _last(u8(c, b + 129), w(c, b + 97));
        bool up = last <= line && v > line;
        bool down = last >= line && v < line;
        return (dir == DIR_UP ? up : dir == DIR_DOWN ? down : (up || down)) ? 1 : 0;
    }

    function _delta(bytes memory c, uint256 b) private view returns (uint256) {
        (bool ok, uint256 v) = _read(c, b);
        if (!ok || v >= HALF) return 2;
        uint256 bps = u32(c, b + 64);
        uint256 dir = u8(c, b + 68);
        uint256 base = _last(u8(c, b + 101), w(c, b + 69));
        // moved by at least bps/10000 of the checkpoint: v*10000 >= base*(10000+bps) (up), v*10000 <= base*(10000-bps) (down)
        bool up = v > base && cmpProducts(v, 10_000, base, 10_000 + bps) >= 1;
        bool down = bps <= 10_000 && v < base && cmpProducts(v, 10_000, base, 10_000 - bps) <= 1;
        return (dir == DIR_UP ? up : dir == DIR_DOWN ? down : (up || down)) ? 1 : 0;
    }

    function _ratio(bytes memory c, uint256 b) private view returns (uint256) {
        (bool okA, uint256 a) = _read(c, b);
        (bool okB, uint256 d) = _read(c, b + SOURCE_SIZE);
        if (!okA || !okB || d == 0) return 2;
        // a / d  OP  num / den   <=>   a * den  OP  num * d   (den > 0, d > 0, exact in 512 bits)
        return opHolds(cmpProducts(a, w(c, b + 161), w(c, b + 129), d), u8(c, b + 128)) ? 1 : 0;
    }

    function _predicate(Ev memory ev, uint256 p, uint256 id, bool exact) private view returns (uint256) {
        uint256 miss = (exact && !ev.debug) ? 2 : 0;
        (bool found, uint256 pos, uint256 len) = _wit(ev, id);
        if (!found) return miss;
        (bool ok, uint256 word) = _callSigner(ev, p + NODE_HEADER, pos, len);
        if (!ok) return ev.debug ? 2 : miss;
        return word == 1 ? 1 : (ev.debug ? 0 : miss);
    }

    /// @dev STATICCALL ICondition.check(params, ctx, witness) with the node's gas cap; ok only for exactly one word back.
    function _callSigner(Ev memory ev, uint256 b, uint256 pos, uint256 len) private view returns (bool ok, uint256 word) {
        if (ev.ctx.length == 0) ev.ctx = abi.encode(ev.ruleId, ev.epoch, ev.popHash);
        bytes memory data = abi.encodeCall(ICondition.check, (_slice(ev.cfg, b + 26, u16(ev.cfg, b + 24)), ev.ctx, _slice(ev.wit, pos, len)));
        address target = addrAt(ev.cfg, b);
        uint256 g = u32(ev.cfg, b + 20);
        uint256 rds;
        assembly ("memory-safe") {
            let m := mload(0x40)
            ok := staticcall(g, target, add(data, 32), mload(data), m, 32)
            rds := returndatasize()
            word := mload(m)
        }
        ok = ok && rds == 32;
    }

    function _slice(bytes memory src, uint256 off, uint256 len) private pure returns (bytes memory out) {
        out = new bytes(len);
        assembly ("memory-safe") {
            mcopy(add(out, 32), add(add(src, 32), off), len)
        }
    }

    /// @dev Reads the value of the 64-byte source at `sp`. ok = false when the read failed (revert, out of its gas cap,
    ///      return data not exactly one word). The STATICCALL gas is the source's own cap, never `gas()`.
    function _read(bytes memory c, uint256 sp) private view returns (bool ok, uint256 v) {
        uint256 kind = u8(c, sp);
        uint256 am = u8(c, sp + 1);
        if (kind == S_STORAGE) return (true, _sload(bytes32(w(c, sp + 32))));
        if (kind == S_ETHBAL) return (true, (am == A_SELF ? address(this) : addrAt(c, sp + 6)).balance);
        uint256 g = u32(c, sp + 2);
        address target = addrAt(c, sp + 6);
        bytes32 sel = kind == S_ERC20 ? bytes32(bytes4(0x70a08231)) : bytes32(w(c, sp + 26)) & bytes32(bytes4(0xffffffff));
        uint256 arg = am == A_SELF ? uint256(uint160(address(this))) : w(c, sp + 32);
        uint256 len = (kind == S_ERC20 || am != A_NONE) ? 36 : 4;
        uint256 rds;
        assembly ("memory-safe") {
            let m := mload(0x40)
            mstore(m, sel)
            mstore(add(m, 4), arg)
            ok := staticcall(g, target, m, len, m, 32)
            rds := returndatasize()
            v := mload(m)
        }
        ok = ok && rds == 32;
    }

    // ------------------------------------------------------------------ action side

    /// @dev After a rule fired: the checkpoint slot of every crossing/delta leaf in ITS tree becomes the value now (value + 1; 0 = none).
    ///      Leaves that name the same slot share one baseline (e.g. an up-crossing rule and a down-crossing rule).
    ///      A read that fails leaves the old checkpoint. Never reverts (reads are gas-capped; state writes need maxStateGasPerFrame).
    function _updateCheckpoints(bytes memory c, uint256 ruleId) private {
        uint256 rec = CONFIG_HEADER + RULE_RECORD * ruleId;
        uint256 p = u16(c, rec + 4);
        uint256 end = p + u16(c, p + 1);
        while (p < end) {
            uint256 t = u8(c, p);
            if (t == T_CROSSING || t == T_DELTA) {
                (bool ok, uint256 v) = _read(c, p + NODE_HEADER);
                if (ok && v < HALF) _sstore(bytes32(uint256(CKPT_BASE) + u8(c, p + NODE_HEADER + (t == T_CROSSING ? 129 : 101))), v + 1);
            }
            // composites: step into the first child; leaves: skip the node
            p += t < 0x10 ? NODE_HEADER + (t == T_KOFN ? 1 : 0) : u16(c, p + 1);
        }
    }
}
