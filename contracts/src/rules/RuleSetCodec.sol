// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Rule-set configuration format. One byte string describes up to 16 rules; each rule is a condition
// tree (AND / OR / NOT / k-of-n over leaves) plus an action and its own nonce-key epoch. The same bytes serve a data-driven
// rule contract (RuleSetContract, built by the SDK, no Solidity needed) and an inheriting developer contract (RuleSet).
//
//   config   := version u8 (=1) | mode u8 (0 independent, 1 else) | ruleCount u8 | nodeCount u16
//               | rule records (16 bytes each) | payload (per rule: tree bytes, then action bytes)
//   rule     := maxFires u16 (0 = unlimited) | baseId u16 | treeOff u16 | actionType u8 | retry u8 (0 or 1)
//               | actionOff u16 | actionLen u16 | actionGas u32                    (offsets are from the config start)
//   node     := type u8 | size u16 (bytes of this node and all its descendants) | count u16 (nodes in this subtree) | body | children
//               children follow the body in order; a node's global id is its preorder index over all rules, so the id of
//               child k is id + 1 + (counts of children 0..k-1). Witness entries and checkpoint slots are keyed by id.
//   source   := 64 bytes: kind u8 | argMode u8 | gas u32 | addr 20 | selector 4 | 0 u16 | word 32   (what a value leaf reads)
//   witness  := entries (nodeId u16 | len u16 | data), ids strictly ascending, nothing after the last entry (verifyData)
//   action   := type 0 NONE | type 1 CALL: target 20 | value 32 | calldata (rest); best effort, never reverts the action

// ---- node types
uint8 constant T_AND = 1;
uint8 constant T_OR = 2;
uint8 constant T_NOT = 3;
uint8 constant T_KOFN = 4; // body: k u8
uint8 constant T_CMP = 0x10; // body: source | op u8 | operand 32
uint8 constant T_RANGE = 0x11; // source | lo 32 | hi 32 | outside u8
uint8 constant T_CROSSING = 0x12; // source | line 32 | dir u8 | initial 32 | slot u8   (stateful)
uint8 constant T_DELTA = 0x13; // source | bps u32 | dir u8 | initial 32 | slot u8       (stateful)
uint8 constant T_RATIO = 0x14; // sourceA | sourceB | op u8 | num 32 | den 32
uint8 constant T_CODEHASH = 0x15; // addr 20 | recorded 32 | mode u8 (0 changed, 1 unchanged)
uint8 constant T_PREDICATE = 0x16; // target 20 | gas u32 | paramsLen u16 | params
uint8 constant T_CONST = 0x17; // value u8

// ---- source kinds and argument modes
uint8 constant S_STORAGE = 0; // word = the rule contract's own storage slot
uint8 constant S_GETTER = 1; // STATICCALL addr.selector(); argMode 0 none, 1 + word, 2 + address(this)
uint8 constant S_ETHBAL = 2; // BALANCE: argMode 1 = addr, 2 = the rule contract
uint8 constant S_ERC20 = 3; // addr.balanceOf(account); argMode 1 = word, 2 = the rule contract
uint8 constant A_NONE = 0;
uint8 constant A_FIXED = 1;
uint8 constant A_SELF = 2;

// ---- comparison ops and directions
uint8 constant OP_GT = 0;
uint8 constant OP_GE = 1;
uint8 constant OP_LT = 2;
uint8 constant OP_LE = 3;
uint8 constant OP_EQ = 4;
uint8 constant OP_NE = 5;
uint8 constant DIR_UP = 0;
uint8 constant DIR_DOWN = 1;
uint8 constant DIR_EITHER = 2;

uint8 constant ACTION_NONE = 0;
uint8 constant ACTION_CALL = 1;

// ---- bounds (a config over them is rejected when the rule contract logic is deployed)
uint256 constant MAX_RULES = 16;
uint256 constant MAX_NODES = 64;
uint256 constant MAX_DEPTH = 8;
uint256 constant MAX_CHILDREN = 16;
uint256 constant MAX_PARAMS = 1024;
uint256 constant MAX_ACTION_DATA = 1024;
/// @dev A CALL action's gas cap may not exceed the factory's per-frame gas bound (16,777,216).
uint256 constant MAX_ACTION_GAS = 16_777_216;
uint256 constant MAX_CONFIG = 16384;
uint256 constant NODE_HEADER = 5;
uint256 constant RULE_RECORD = 16;
uint256 constant CONFIG_HEADER = 5;
uint256 constant SOURCE_SIZE = 64;

// ---- raw readers over a validated config (no bounds checks: validate() ran at deployment)
function u8(bytes memory b, uint256 o) pure returns (uint256 v) {
    assembly ("memory-safe") {
        v := byte(0, mload(add(add(b, 32), o)))
    }
}

function u16(bytes memory b, uint256 o) pure returns (uint256 v) {
    assembly ("memory-safe") {
        v := shr(240, mload(add(add(b, 32), o)))
    }
}

function u32(bytes memory b, uint256 o) pure returns (uint256 v) {
    assembly ("memory-safe") {
        v := shr(224, mload(add(add(b, 32), o)))
    }
}

function w(bytes memory b, uint256 o) pure returns (uint256 v) {
    assembly ("memory-safe") {
        v := mload(add(add(b, 32), o))
    }
}

function addrAt(bytes memory b, uint256 o) pure returns (address a) {
    assembly ("memory-safe") {
        a := shr(96, mload(add(add(b, 32), o)))
    }
}

/// @notice Rule-set encoder (for Solidity developers and tests) and validator (run once, in the logic's constructor).
library RuleSetCodec {
    error ConfigTooLarge(uint256 size);
    error BadConfig(uint256 code, uint256 at);
    error PredicateInNegativeContext(uint256 nodeId);

    // BadConfig codes
    uint256 internal constant E_HEADER = 1; // version, mode, rule count, node count, truncated
    uint256 internal constant E_RULE_TABLE = 2; // offsets not contiguous / not ending at the config's end
    uint256 internal constant E_ACTION = 3;
    uint256 internal constant E_NODE = 4; // header, size, count, type
    uint256 internal constant E_DEPTH = 5;
    uint256 internal constant E_CHILDREN = 6; // child count out of 1..16 (NOT: exactly 1), k out of 1..n
    uint256 internal constant E_LEAF = 7; // leaf body size or field out of range
    uint256 internal constant E_SOURCE = 8;
    uint256 internal constant E_NODES = 9; // more than MAX_NODES

    struct Rule {
        bytes tree;
        uint8 actionType;
        bytes action;
        uint16 maxFires;
        uint32 actionGas;
        /// @dev 1: a failed CALL does not count toward maxFires (the epoch still advances, so the rule can be triggered again)
        bool retry;
    }

    // ------------------------------------------------------------------ encoder

    function encode(uint8 mode, Rule[] memory rules) internal pure returns (bytes memory out) {
        uint256 n = rules.length;
        uint256 cur = CONFIG_HEADER + RULE_RECORD * n;
        uint256 total;
        for (uint256 i; i < n; ++i) total += u16(rules[i].tree, 3);
        out = abi.encodePacked(uint8(1), mode, uint8(n), uint16(total));
        bytes memory payload;
        uint256 baseId;
        for (uint256 i; i < n; ++i) {
            Rule memory r = rules[i];
            uint256 treeOff = cur;
            cur += r.tree.length;
            uint256 actionOff = cur;
            cur += r.action.length;
            out = bytes.concat(out, abi.encodePacked(r.maxFires, uint16(baseId), uint16(treeOff), r.actionType, r.retry ? uint8(1) : uint8(0), uint16(actionOff), uint16(r.action.length), r.actionGas));
            payload = bytes.concat(payload, r.tree, r.action);
            baseId += u16(r.tree, 3);
        }
        out = bytes.concat(out, payload);
    }

    function rule(bytes memory tree, uint16 maxFires, uint8 actionType, bytes memory action, uint32 actionGas) internal pure returns (Rule memory) {
        return Rule(tree, actionType, action, maxFires, actionGas, false);
    }

    /// @notice The same rule, but a failed CALL does not count toward maxFires.
    function withRetry(Rule memory r) internal pure returns (Rule memory) {
        r.retry = true;
        return r;
    }

    function actionCall(address target, uint256 value, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodePacked(target, value, data);
    }

    function node(uint8 t, bytes memory body, bytes[] memory kids) internal pure returns (bytes memory out) {
        uint256 size = NODE_HEADER + body.length;
        uint256 cnt = 1;
        for (uint256 i; i < kids.length; ++i) {
            size += kids[i].length;
            cnt += u16(kids[i], 3);
        }
        require(size <= type(uint16).max && cnt <= type(uint16).max, "node too large");
        out = abi.encodePacked(t, uint16(size), uint16(cnt), body);
        for (uint256 i; i < kids.length; ++i) out = bytes.concat(out, kids[i]);
    }

    function and_(bytes[] memory kids) internal pure returns (bytes memory) {
        return node(T_AND, "", kids);
    }

    function or_(bytes[] memory kids) internal pure returns (bytes memory) {
        return node(T_OR, "", kids);
    }

    function not_(bytes memory kid) internal pure returns (bytes memory) {
        bytes[] memory k = new bytes[](1);
        k[0] = kid;
        return node(T_NOT, "", k);
    }

    function kofn(uint8 k, bytes[] memory kids) internal pure returns (bytes memory) {
        return node(T_KOFN, abi.encodePacked(k), kids);
    }

    function leaf(uint8 t, bytes memory body) internal pure returns (bytes memory) {
        return node(t, body, new bytes[](0));
    }

    function source(uint8 kind, uint8 argMode, uint32 gas, address a, bytes4 selector, bytes32 word) internal pure returns (bytes memory) {
        return abi.encodePacked(kind, argMode, gas, a, selector, uint16(0), word);
    }

    function srcStorage(bytes32 slot) internal pure returns (bytes memory) {
        return source(S_STORAGE, A_NONE, 0, address(0), bytes4(0), slot);
    }

    function srcGetter(address target, bytes4 selector, uint32 gas) internal pure returns (bytes memory) {
        return source(S_GETTER, A_NONE, gas, target, selector, 0);
    }

    function srcGetterArg(address target, bytes4 selector, bytes32 arg, uint32 gas) internal pure returns (bytes memory) {
        return source(S_GETTER, A_FIXED, gas, target, selector, arg);
    }

    function srcGetterSelf(address target, bytes4 selector, uint32 gas) internal pure returns (bytes memory) {
        return source(S_GETTER, A_SELF, gas, target, selector, 0);
    }

    function srcEthBalance(address account) internal pure returns (bytes memory) {
        return source(S_ETHBAL, A_FIXED, 0, account, bytes4(0), 0);
    }

    function srcEthBalanceSelf() internal pure returns (bytes memory) {
        return source(S_ETHBAL, A_SELF, 0, address(0), bytes4(0), 0);
    }

    function srcErc20(address token, address account, uint32 gas) internal pure returns (bytes memory) {
        return source(S_ERC20, A_FIXED, gas, token, bytes4(0), bytes32(uint256(uint160(account))));
    }

    function srcErc20Self(address token, uint32 gas) internal pure returns (bytes memory) {
        return source(S_ERC20, A_SELF, gas, token, bytes4(0), 0);
    }

    function cmp(bytes memory src, uint8 op, uint256 operand) internal pure returns (bytes memory) {
        return leaf(T_CMP, abi.encodePacked(src, op, operand));
    }

    function range(bytes memory src, uint256 lo, uint256 hi, bool outside) internal pure returns (bytes memory) {
        return leaf(T_RANGE, abi.encodePacked(src, lo, hi, outside ? uint8(1) : uint8(0)));
    }

    function crossing(bytes memory src, uint256 line, uint8 dir, uint256 initial, uint8 slot) internal pure returns (bytes memory) {
        return leaf(T_CROSSING, abi.encodePacked(src, line, dir, initial, slot));
    }

    function delta(bytes memory src, uint32 bps, uint8 dir, uint256 initial, uint8 slot) internal pure returns (bytes memory) {
        return leaf(T_DELTA, abi.encodePacked(src, bps, dir, initial, slot));
    }

    function ratio(bytes memory a, bytes memory b, uint8 op, uint256 num, uint256 den) internal pure returns (bytes memory) {
        return leaf(T_RATIO, abi.encodePacked(a, b, op, num, den));
    }

    function codehash(address account, bytes32 recorded, bool unchanged) internal pure returns (bytes memory) {
        return leaf(T_CODEHASH, abi.encodePacked(account, recorded, unchanged ? uint8(1) : uint8(0)));
    }

    function predicate(address target, uint32 gas, bytes memory params) internal pure returns (bytes memory) {
        return leaf(T_PREDICATE, abi.encodePacked(target, gas, uint16(params.length), params));
    }

    function constant_(bool v) internal pure returns (bytes memory) {
        return leaf(T_CONST, abi.encodePacked(v ? uint8(1) : uint8(0)));
    }

    // ------------------------------------------------------------------ validator

    /// @notice Reverts unless `c` is a well-formed config within every bound: sizes, offsets, depth, node count, child counts,
    ///         leaf fields, and no predicate leaf where its result would be used negatively (see RuleSet "polarity").
    function validate(bytes memory c) internal pure {
        if (c.length > MAX_CONFIG) revert ConfigTooLarge(c.length);
        if (c.length < CONFIG_HEADER) revert BadConfig(E_HEADER, 0);
        uint256 n = u8(c, 2);
        if (u8(c, 0) != 1 || u8(c, 1) > 1 || n == 0 || n > MAX_RULES) revert BadConfig(E_HEADER, 0);
        if (u16(c, 3) > MAX_NODES) revert BadConfig(E_NODES, u16(c, 3));
        uint256 cur = CONFIG_HEADER + RULE_RECORD * n;
        if (c.length < cur) revert BadConfig(E_HEADER, c.length);
        uint256 baseId;
        for (uint256 i; i < n; ++i) {
            uint256 rec = CONFIG_HEADER + RULE_RECORD * i;
            if (u16(c, rec + 2) != baseId || u16(c, rec + 4) != cur || u8(c, rec + 7) > 1) revert BadConfig(E_RULE_TABLE, i);
            if (cur + NODE_HEADER > c.length) revert BadConfig(E_RULE_TABLE, i);
            uint256 treeEnd = cur + u16(c, cur + 1);
            if (treeEnd > c.length) revert BadConfig(E_RULE_TABLE, i);
            // trees 0..n-2 of an else set are evaluated exactly (negated) by the later rules
            uint256 cnt = _node(c, cur, treeEnd, 1, u8(c, 1) == 1 && i + 1 < n, baseId);
            baseId += cnt;
            if (baseId > MAX_NODES) revert BadConfig(E_NODES, baseId);
            _action(c, rec, treeEnd, i);
            cur = u16(c, rec + 8) + u16(c, rec + 10);
        }
        if (baseId != u16(c, 3)) revert BadConfig(E_HEADER, baseId);
        if (cur != c.length) revert BadConfig(E_RULE_TABLE, cur);
    }

    function _action(bytes memory c, uint256 rec, uint256 treeEnd, uint256 i) private pure {
        uint256 t = u8(c, rec + 6);
        uint256 off = u16(c, rec + 8);
        uint256 len = u16(c, rec + 10);
        if (off != treeEnd || off + len > c.length) revert BadConfig(E_ACTION, i);
        if (t == ACTION_NONE) {
            if (len != 0 || u32(c, rec + 12) != 0) revert BadConfig(E_ACTION, i);
        } else if (t == ACTION_CALL) {
            if (len < 52 || len > 52 + MAX_ACTION_DATA || u32(c, rec + 12) == 0 || u32(c, rec + 12) > MAX_ACTION_GAS) revert BadConfig(E_ACTION, i);
        } else {
            revert BadConfig(E_ACTION, i);
        }
    }

    /// @dev Validates the node at p (it must end at or before `end`) and returns its subtree's node count.
    function _node(bytes memory c, uint256 p, uint256 end, uint256 depth, bool exact, uint256 id) private pure returns (uint256) {
        if (depth > MAX_DEPTH) revert BadConfig(E_DEPTH, p);
        if (p + NODE_HEADER > end) revert BadConfig(E_NODE, p);
        uint256 t = u8(c, p);
        uint256 size = u16(c, p + 1);
        if (size < NODE_HEADER || p + size > end) revert BadConfig(E_NODE, p);
        uint256 cnt;
        if (t < 0x10) {
            if (t == 0 || t > T_KOFN) revert BadConfig(E_NODE, p);
            cnt = _composite(c, t, p, size, depth, exact, id);
        } else {
            _leaf(c, t, p, size, exact, id);
            cnt = 1;
        }
        if (u16(c, p + 3) != cnt) revert BadConfig(E_NODE, p);
        return cnt;
    }

    function _composite(bytes memory c, uint256 t, uint256 p, uint256 size, uint256 depth, bool exact, uint256 id) private pure returns (uint256 cnt) {
        uint256 q = p + NODE_HEADER;
        uint256 end = p + size;
        uint256 k;
        if (t == T_KOFN) {
            if (q >= end) revert BadConfig(E_NODE, p);
            k = u8(c, q);
            q += 1;
        }
        bool childExact = exact || t == T_NOT;
        cnt = 1;
        uint256 n;
        while (q < end) {
            uint256 cc = _node(c, q, end, depth + 1, childExact, id + cnt);
            cnt += cc;
            q += u16(c, q + 1);
            ++n;
        }
        if (q != end || n == 0 || n > MAX_CHILDREN || (t == T_NOT && n != 1) || (t == T_KOFN && (k == 0 || k > n))) revert BadConfig(E_CHILDREN, p);
    }

    function _leaf(bytes memory c, uint256 t, uint256 p, uint256 size, bool exact, uint256 id) private pure {
        uint256 b = p + NODE_HEADER;
        uint256 body = size - NODE_HEADER;
        if (t == T_CONST) {
            if (body != 1 || u8(c, b) > 1) revert BadConfig(E_LEAF, p);
        } else if (t == T_CMP) {
            if (body != 97 || u8(c, b + 64) > OP_NE) revert BadConfig(E_LEAF, p);
            _source(c, b, p);
        } else if (t == T_RANGE) {
            if (body != 129 || u8(c, b + 128) > 1 || w(c, b + 64) > w(c, b + 96)) revert BadConfig(E_LEAF, p);
            _source(c, b, p);
        } else if (t == T_CROSSING) {
            if (body != 130 || u8(c, b + 96) > DIR_EITHER) revert BadConfig(E_LEAF, p);
            _source(c, b, p);
        } else if (t == T_DELTA) {
            if (body != 102 || u8(c, b + 68) > DIR_EITHER || u32(c, b + 64) == 0 || u32(c, b + 64) > 10_000_000) revert BadConfig(E_LEAF, p);
            if (u8(c, b + 68) != DIR_UP && u32(c, b + 64) > 10_000) revert BadConfig(E_LEAF, p); // a fall of more than 100% cannot happen
            _source(c, b, p);
        } else if (t == T_RATIO) {
            if (body != 193 || u8(c, b + 128) > OP_NE || w(c, b + 161) == 0) revert BadConfig(E_LEAF, p);
            _source(c, b, p);
            _source(c, b + SOURCE_SIZE, p);
        } else if (t == T_CODEHASH) {
            if (body != 53 || u8(c, b + 52) > 1) revert BadConfig(E_LEAF, p);
        } else if (t == T_PREDICATE) {
            if (body < 26 || body - 26 != u16(c, b + 24) || body - 26 > MAX_PARAMS || u32(c, b + 20) == 0) revert BadConfig(E_LEAF, p);
            if (exact) revert PredicateInNegativeContext(id);
        } else {
            revert BadConfig(E_NODE, p);
        }
    }

    function _source(bytes memory c, uint256 s, uint256 at) private pure {
        uint256 kind = u8(c, s);
        uint256 am = u8(c, s + 1);
        if (u16(c, s + 30) != 0) revert BadConfig(E_SOURCE, at);
        if (kind == S_STORAGE) {
            if (am != A_NONE || u32(c, s + 2) != 0 || addrAt(c, s + 6) != address(0) || u32(c, s + 26) != 0) revert BadConfig(E_SOURCE, at);
        } else if (kind == S_GETTER) {
            if (am > A_SELF || u32(c, s + 2) == 0 || (am != A_FIXED && w(c, s + 32) != 0)) revert BadConfig(E_SOURCE, at);
        } else if (kind == S_ETHBAL) {
            if ((am != A_FIXED && am != A_SELF) || u32(c, s + 2) != 0 || u32(c, s + 26) != 0 || w(c, s + 32) != 0) revert BadConfig(E_SOURCE, at);
            if (am == A_SELF && addrAt(c, s + 6) != address(0)) revert BadConfig(E_SOURCE, at);
        } else if (kind == S_ERC20) {
            if ((am != A_FIXED && am != A_SELF) || u32(c, s + 2) == 0 || u32(c, s + 26) != 0) revert BadConfig(E_SOURCE, at);
            if (am == A_SELF && w(c, s + 32) != 0) revert BadConfig(E_SOURCE, at);
            if (am == A_FIXED && w(c, s + 32) >> 160 != 0) revert BadConfig(E_SOURCE, at);
        } else {
            revert BadConfig(E_SOURCE, at);
        }
    }
}
