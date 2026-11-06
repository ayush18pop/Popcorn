// Encoder, strict decoder and validator for the rule-set config (format: contracts/src/rules/RuleSetCodec.sol header).
// validateRuleSet mirrors RuleSetCodec.validate (bounds, structure, polarity), so a config the SDK accepts is one the
// logic's constructor accepts; test/ruleset.test.ts and contracts/test/RuleSetCodec.t.sol pin both to shared vectors.
import { bytesToHex, concatHex, getAddress, hexToBigInt, hexToBytes, isAddress, pad, size, toHex, type Address, type Hex } from "viem";
import { PopcornError } from "../errors.ts";
import { DEFAULT_CALL_GAS, DEFAULT_PREDICATE_GAS, DEFAULT_READ_GAS, type Action, type Dir, type Node, type Op, type RuleSetSpec, type RuleSpec, type Source } from "./spec.ts";

export const RULESET_LIMITS = {
  MAX_RULES: 16,
  MAX_NODES: 64,
  MAX_DEPTH: 8,
  MAX_CHILDREN: 16,
  MAX_PARAMS: 1024,
  MAX_ACTION_DATA: 1024,
  MAX_ACTION_GAS: 16_777_216,
  MAX_CONFIG: 16384,
  MAX_WITNESS_ENTRY: 0xffff,
} as const;

export class RuleSetInvalid extends PopcornError {
  constructor(readonly issues: string[]) {
    super(`invalid rule set: ${issues.join("; ")}`);
    this.name = "RuleSetInvalid";
  }
}

// type ids (same as RuleSetCodec.sol)
export const T = { and: 1, or: 2, not: 3, kofn: 4, exactly: 5, cmp: 0x10, range: 0x11, crossing: 0x12, delta: 0x13, ratio: 0x14, codeHash: 0x15, predicate: 0x16, const: 0x17 } as const;
const OPS: Op[] = ["gt", "ge", "lt", "le", "eq", "ne"];
const DIRS: Dir[] = ["up", "down", "either"];
const HEADER = 5;

const u = (v: number | bigint, bytes: number): Hex => toHex(BigInt(v), { size: bytes });
const word = (v: bigint): Hex => u(v, 32);
const MAX256 = (1n << 256n) - 1n;
const HALF = 1n << 255n;

// ---------------------------------------------------------------- structure helpers

export const isComposite = (n: Node): n is Extract<Node, { type: "and" | "or" | "not" | "kofn" | "exactly" }> =>
  n.type === "and" || n.type === "or" || n.type === "not" || n.type === "kofn" || n.type === "exactly";
export const childrenOf = (n: Node): Node[] =>
  n.type === "and" || n.type === "or" || n.type === "kofn" || n.type === "exactly" ? n.children : n.type === "not" ? [n.child] : [];
export const countNodes = (n: Node): number => 1 + childrenOf(n).reduce((a, c) => a + countNodes(c), 0);
const isStateful = (n: Node) => n.type === "crossing" || n.type === "delta";

/** Preorder nodes of one rule tree with their global id (id = base + preorder position), as the contract numbers them. */
export interface NodeInfo {
  /** Global node id (witness entries and the debug view's `nodes` use id - rule.baseId). */
  id: number;
  ruleId: number;
  /** Index in the rule's preorder (id - baseId). */
  index: number;
  depth: number;
  node: Node;
  /** Preorder indexes (rule-relative) of the children. */
  children: number[];
  /** Under a NOT or an exactly-k, or in an earlier tree of an else set: evaluated exactly (no hint, unknown propagates). */
  exact: boolean;
}

export interface RuleLayout {
  ruleId: number;
  baseId: number;
  count: number;
  nodes: NodeInfo[];
}

export function layoutRuleSet(spec: RuleSetSpec): RuleLayout[] {
  const out: RuleLayout[] = [];
  let base = 0;
  spec.rules.forEach((r, ruleId) => {
    const nodes: NodeInfo[] = [];
    const walk = (n: Node, depth: number, exact: boolean): number => {
      const index = nodes.length;
      const info: NodeInfo = { id: base + index, ruleId, index, depth, node: n, children: [], exact };
      nodes.push(info);
      for (const c of childrenOf(n)) info.children.push(walk(c, depth + 1, exact || n.type === "not" || n.type === "exactly"));
      return index;
    };
    walk(r.when, 1, spec.mode === "else" && ruleId + 1 < spec.rules.length);
    out.push({ ruleId, baseId: base, count: nodes.length, nodes });
    base += nodes.length;
  });
  return out;
}

// ---------------------------------------------------------------- validation (mirror of RuleSetCodec.validate)

export function validateRuleSet(spec: RuleSetSpec): string[] {
  const issues: string[] = [];
  const L = RULESET_LIMITS;
  const bad = (m: string) => issues.push(m);
  if (spec.mode !== "independent" && spec.mode !== "else") bad(`mode must be "independent" or "else"`);
  if (spec.rules.length < 1 || spec.rules.length > L.MAX_RULES) bad(`rule count ${spec.rules.length} outside 1..${L.MAX_RULES}`);
  let total = 0;
  const layout = layoutRuleSet(spec);
  for (const l of layout) total += l.count;
  if (total > L.MAX_NODES) bad(`${total} nodes (max ${L.MAX_NODES})`);
  const inUnit = (v: bigint, what: string, at: string) => {
    if (typeof v !== "bigint" || v < 0n || v > MAX256) bad(`${at}: ${what} is not a uint256`);
  };
  const checkSource = (s: Source, at: string) => {
    if (s.kind === "storage") {
      if (size(s.slot) !== 32) bad(`${at}: storage slot must be 32 bytes`);
    } else if (s.kind === "getter") {
      if (!isAddress(s.target)) bad(`${at}: getter target is not an address`);
      if (size(s.selector) !== 4) bad(`${at}: getter selector must be 4 bytes`);
      if (s.arg !== undefined && s.arg !== "self" && size(s.arg) > 32) bad(`${at}: getter arg longer than 32 bytes`);
      const g = s.gas ?? DEFAULT_READ_GAS;
      if (!Number.isInteger(g) || g < 1 || g > 0xffffffff) bad(`${at}: read gas cap ${g} outside 1..2^32-1`);
    } else if (s.kind === "ethBalance") {
      if (s.account !== "self" && !isAddress(s.account)) bad(`${at}: ETH balance account is not an address`);
    } else if (s.kind === "erc20") {
      if (!isAddress(s.token)) bad(`${at}: token is not an address`);
      if (s.account !== "self" && !isAddress(s.account)) bad(`${at}: account is not an address`);
      const g = s.gas ?? DEFAULT_READ_GAS;
      if (!Number.isInteger(g) || g < 1 || g > 0xffffffff) bad(`${at}: read gas cap ${g} outside 1..2^32-1`);
    } else bad(`${at}: unknown source kind`);
  };
  for (const l of layout) {
    const rule = spec.rules[l.ruleId]!;
    const rp = `rule ${l.ruleId}${rule.name ? ` (${rule.name})` : ""}`;
    const mf = rule.maxFires ?? 1;
    if (!Number.isInteger(mf) || mf < 0 || mf > 0xffff) bad(`${rp}: maxFires ${mf} outside 0..65535`);
    const a = rule.action ?? { type: "none" };
    if (a.type === "call") {
      if (!isAddress(a.target)) bad(`${rp}: action target is not an address`);
      if (a.data && size(a.data) > L.MAX_ACTION_DATA) bad(`${rp}: action data over ${L.MAX_ACTION_DATA} bytes`);
      const g = a.gas ?? DEFAULT_CALL_GAS;
      if (!Number.isInteger(g) || g < 1 || g > L.MAX_ACTION_GAS) bad(`${rp}: action gas ${g} outside 1..${L.MAX_ACTION_GAS} (the per-frame gas bound)`);
      if ((a.value ?? 0n) < 0n || (a.value ?? 0n) > MAX256) bad(`${rp}: action value is not a uint256`);
    } else if (a.type !== "none") bad(`${rp}: unknown action type`);
    for (const n of l.nodes) {
      const at = `${rp} node ${n.index} (${n.node.type})`;
      if (n.depth > L.MAX_DEPTH) bad(`${at}: depth ${n.depth} over ${L.MAX_DEPTH}`);
      const x = n.node;
      if (x.type === "and" || x.type === "or" || x.type === "kofn" || x.type === "exactly") {
        if (x.children.length < 1 || x.children.length > L.MAX_CHILDREN) bad(`${at}: ${x.children.length} children (1..${L.MAX_CHILDREN})`);
        if ((x.type === "kofn" || x.type === "exactly") && (!Number.isInteger(x.k) || x.k < 1 || x.k > x.children.length)) bad(`${at}: k=${x.k} outside 1..${x.children.length}`);
      } else if (x.type === "not") {
        // exactly one child by construction
      } else if (x.type === "cmp") {
        checkSource(x.source, at);
        if (!OPS.includes(x.op)) bad(`${at}: unknown op`);
        inUnit(x.value, "value", at);
      } else if (x.type === "range") {
        checkSource(x.source, at);
        inUnit(x.lo, "lo", at);
        inUnit(x.hi, "hi", at);
        if (x.lo > x.hi) bad(`${at}: lo > hi`);
      } else if (x.type === "crossing") {
        checkSource(x.source, at);
        inUnit(x.line, "line", at);
        inUnit(x.initial, "initial", at);
        if (!DIRS.includes(x.dir)) bad(`${at}: unknown direction`);
        if (x.slot !== undefined && (!Number.isInteger(x.slot) || x.slot < 0 || x.slot > 255)) bad(`${at}: slot outside 0..255`);
      } else if (x.type === "delta") {
        checkSource(x.source, at);
        inUnit(x.initial, "initial", at);
        if (!DIRS.includes(x.dir)) bad(`${at}: unknown direction`);
        if (!Number.isInteger(x.bps) || x.bps < 1 || x.bps > 10_000_000) bad(`${at}: bps ${x.bps} outside 1..10,000,000`);
        else if (x.dir !== "up" && x.bps > 10_000) bad(`${at}: a fall of more than 100% cannot happen`);
        if (x.slot !== undefined && (!Number.isInteger(x.slot) || x.slot < 0 || x.slot > 255)) bad(`${at}: slot outside 0..255`);
      } else if (x.type === "ratio") {
        checkSource(x.a, at);
        checkSource(x.b, at);
        if (!OPS.includes(x.op)) bad(`${at}: unknown op`);
        inUnit(x.num, "num", at);
        inUnit(x.den, "den", at);
        if (x.den === 0n) bad(`${at}: den is 0`);
      } else if (x.type === "codeHash") {
        if (!isAddress(x.account)) bad(`${at}: account is not an address`);
        if (size(x.recorded) !== 32) bad(`${at}: recorded hash must be 32 bytes`);
      } else if (x.type === "predicate") {
        if (!isAddress(x.target)) bad(`${at}: predicate target is not an address`);
        const g = x.gas ?? DEFAULT_PREDICATE_GAS;
        if (!Number.isInteger(g) || g < 1 || g > 0xffffffff) bad(`${at}: gas cap ${g} outside 1..2^32-1`);
        if (x.params && size(x.params) > L.MAX_PARAMS) bad(`${at}: params over ${L.MAX_PARAMS} bytes`);
        if (n.exact) bad(`${at}: a predicate cannot be used under NOT or exactly-k, or in an earlier tree of an else set (its false means "the witness failed"); move it to the last rule or use independent mode`);
      } else if (x.type === "const") {
        if (typeof x.value !== "boolean") bad(`${at}: const value must be boolean`);
      } else bad(`${at}: unknown node type`);
    }
  }
  if (issues.length === 0) {
    const bytes = size(encodeUnchecked(spec));
    if (bytes > L.MAX_CONFIG) bad(`config is ${bytes} bytes (max ${L.MAX_CONFIG})`);
  }
  return issues;
}

// ---------------------------------------------------------------- encode

const argWord = (a: Hex): Hex => pad(a, { size: 32 });
const selOf = (s: Hex): Hex => s.toLowerCase() as Hex;

/** 64 bytes: kind | argMode | gas u32 | addr 20 | selector 4 | 0 u16 | word 32 */
export function encodeSource(s: Source): Hex {
  const raw = (kind: number, argMode: number, gas: number, addr: Hex, selector: Hex, w: Hex): Hex => concatHex([u(kind, 1), u(argMode, 1), u(gas, 4), addr, selector, "0x0000", w]);
  const Z20 = "0x0000000000000000000000000000000000000000" as Hex;
  const Z4 = "0x00000000" as Hex;
  const Z32 = word(0n);
  switch (s.kind) {
    case "storage":
      return raw(0, 0, 0, Z20, Z4, s.slot);
    case "getter":
      return raw(1, s.arg === undefined ? 0 : s.arg === "self" ? 2 : 1, s.gas ?? DEFAULT_READ_GAS, s.target, selOf(s.selector), s.arg === undefined || s.arg === "self" ? Z32 : argWord(s.arg));
    case "ethBalance":
      return s.account === "self" ? raw(2, 2, 0, Z20, Z4, Z32) : raw(2, 1, 0, s.account, Z4, Z32);
    case "erc20":
      return s.account === "self" ? raw(3, 2, s.gas ?? DEFAULT_READ_GAS, s.token, Z4, Z32) : raw(3, 1, s.gas ?? DEFAULT_READ_GAS, s.token, Z4, argWord(s.account));
  }
}

/** Slots for crossing/delta leaves: explicit ones as given, the rest the smallest unused number, in encounter order. */
export function assignSlots(spec: RuleSetSpec): Map<Node, number> {
  const taken = new Set<number>();
  for (const r of spec.rules) {
    const walk = (n: Node) => {
      if ((n.type === "crossing" || n.type === "delta") && n.slot !== undefined) taken.add(n.slot);
      childrenOf(n).forEach(walk);
    };
    walk(r.when);
  }
  const out = new Map<Node, number>();
  let next = 0;
  for (const r of spec.rules) {
    const walk = (n: Node) => {
      if (n.type === "crossing" || n.type === "delta") {
        if (n.slot !== undefined) out.set(n, n.slot);
        else {
          while (taken.has(next)) next++;
          out.set(n, next);
          taken.add(next);
        }
      }
      childrenOf(n).forEach(walk);
    };
    walk(r.when);
  }
  return out;
}

function encodeNode(n: Node, slots: Map<Node, number>): Hex {
  const node = (t: number, body: Hex, kids: Hex[]): Hex => {
    const sz = HEADER + size(body) + kids.reduce((a, k) => a + size(k), 0);
    const cnt = 1 + kids.reduce((a, k) => a + Number(hexToBigInt(`0x${k.slice(8, 12)}` as Hex)), 0);
    return concatHex([u(t, 1), u(sz, 2), u(cnt, 2), body, ...kids]);
  };
  switch (n.type) {
    case "and":
      return node(T.and, "0x", n.children.map((c) => encodeNode(c, slots)));
    case "or":
      return node(T.or, "0x", n.children.map((c) => encodeNode(c, slots)));
    case "not":
      return node(T.not, "0x", [encodeNode(n.child, slots)]);
    case "kofn":
      return node(T.kofn, u(n.k, 1), n.children.map((c) => encodeNode(c, slots)));
    case "exactly":
      return node(T.exactly, u(n.k, 1), n.children.map((c) => encodeNode(c, slots)));
    case "cmp":
      return node(T.cmp, concatHex([encodeSource(n.source), u(OPS.indexOf(n.op), 1), word(n.value)]), []);
    case "range":
      return node(T.range, concatHex([encodeSource(n.source), word(n.lo), word(n.hi), u(n.outside ? 1 : 0, 1)]), []);
    case "crossing":
      return node(T.crossing, concatHex([encodeSource(n.source), word(n.line), u(DIRS.indexOf(n.dir), 1), word(n.initial), u(slots.get(n)!, 1)]), []);
    case "delta":
      return node(T.delta, concatHex([encodeSource(n.source), u(n.bps, 4), u(DIRS.indexOf(n.dir), 1), word(n.initial), u(slots.get(n)!, 1)]), []);
    case "ratio":
      return node(T.ratio, concatHex([encodeSource(n.a), encodeSource(n.b), u(OPS.indexOf(n.op), 1), word(n.num), word(n.den)]), []);
    case "codeHash":
      return node(T.codeHash, concatHex([n.account, n.recorded, u(n.unchanged ? 1 : 0, 1)]), []);
    case "predicate": {
      const params = n.params ?? "0x";
      return node(T.predicate, concatHex([n.target, u(n.gas ?? DEFAULT_PREDICATE_GAS, 4), u(size(params), 2), params]), []);
    }
    case "const":
      return node(T.const, u(n.value ? 1 : 0, 1), []);
  }
}

/** The retry flag as encoded: explicit, else true for a CALL action. */
export const retryOf = (r: RuleSpec): boolean => r.retryOnFailure ?? (r.action?.type === "call");

/** Encodes WITHOUT validating (tests and tooling that need to build a config the validators must refuse). */
export function encodeRuleSetUnchecked(spec: RuleSetSpec): Hex {
  return encodeUnchecked(spec);
}

function encodeUnchecked(spec: RuleSetSpec): Hex {
  const slots = assignSlots(spec);
  const n = spec.rules.length;
  let cur = HEADER + 16 * n;
  let base = 0;
  const recs: Hex[] = [];
  const payload: Hex[] = [];
  for (const r of spec.rules) {
    const tree = encodeNode(r.when, slots);
    const a: Action = r.action ?? { type: "none" };
    const actionBytes: Hex = a.type === "call" ? concatHex([a.target, word(a.value ?? 0n), a.data ?? "0x"]) : "0x";
    const treeOff = cur;
    cur += size(tree);
    const actionOff = cur;
    cur += size(actionBytes);
    recs.push(concatHex([u(r.maxFires ?? 1, 2), u(base, 2), u(treeOff, 2), u(a.type === "call" ? 1 : 0, 1), u(retryOf(r) ? 1 : 0, 1), u(actionOff, 2), u(size(actionBytes), 2), u(a.type === "call" ? (a.gas ?? DEFAULT_CALL_GAS) : 0, 4)]));
    payload.push(tree, actionBytes);
    base += countNodes(r.when);
  }
  // lower case: the canonical form (decode returns checksummed addresses, which must re-encode to the same bytes)
  return concatHex([u(1, 1), u(spec.mode === "else" ? 1 : 0, 1), u(n, 1), u(base, 2), ...recs, ...payload]).toLowerCase() as Hex;
}

/** Validates, then returns the config bytes (throws RuleSetInvalid listing every problem). */
export function encodeRuleSet(spec: RuleSetSpec): Hex {
  const issues = validateRuleSet(spec);
  if (issues.length) throw new RuleSetInvalid(issues);
  return encodeUnchecked(spec);
}

// ---------------------------------------------------------------- decode (strict)

class Reader {
  b: Uint8Array;
  constructor(h: Hex) {
    this.b = hexToBytes(h);
  }
  u(o: number, n: number): number {
    if (o + n > this.b.length) throw new RuleSetInvalid([`truncated at byte ${o}`]);
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + this.b[o + i]!;
    return v;
  }
  hex(o: number, n: number): Hex {
    if (o + n > this.b.length) throw new RuleSetInvalid([`truncated at byte ${o}`]);
    return bytesToHex(this.b.subarray(o, o + n));
  }
  w(o: number): bigint {
    return hexToBigInt(this.hex(o, 32));
  }
}

function decodeSource(r: Reader, s: number): Source {
  const kind = r.u(s, 1);
  const am = r.u(s + 1, 1);
  const gas = r.u(s + 2, 4);
  const addr = r.hex(s + 6, 20);
  const sel = r.hex(s + 26, 4);
  const wd = r.hex(s + 32, 32);
  if (r.u(s + 30, 2) !== 0) throw new RuleSetInvalid(["source pad bytes not zero"]);
  if (kind === 0) return { kind: "storage", slot: wd };
  if (kind === 1) return { kind: "getter", target: getAddress(addr), selector: sel, gas, ...(am === 0 ? {} : am === 2 ? { arg: "self" as const } : { arg: wd }) };
  if (kind === 2) return { kind: "ethBalance", account: am === 2 ? "self" : getAddress(addr) };
  if (kind === 3) return { kind: "erc20", token: getAddress(addr), account: am === 2 ? "self" : getAddress(`0x${wd.slice(26)}`), gas };
  throw new RuleSetInvalid([`source kind ${kind}`]);
}

function decodeNode(r: Reader, p: number): { node: Node; size: number } {
  const t = r.u(p, 1);
  const sz = r.u(p + 1, 2);
  const b = p + HEADER;
  const kids = (from: number): Node[] => {
    const out: Node[] = [];
    let q = from;
    while (q < p + sz) {
      const c = decodeNode(r, q);
      out.push(c.node);
      q += c.size;
    }
    return out;
  };
  const leaf = (node: Node, body: number): { node: Node; size: number } => {
    if (sz !== HEADER + body) throw new RuleSetInvalid([`node at byte ${p}: size ${sz}, expected ${HEADER + body}`]);
    return { node, size: sz };
  };
  switch (t) {
    case T.and:
      return { node: { type: "and", children: kids(b) }, size: sz };
    case T.or:
      return { node: { type: "or", children: kids(b) }, size: sz };
    case T.not: {
      const k = kids(b);
      if (k.length !== 1) throw new RuleSetInvalid([`NOT at byte ${p} has ${k.length} children`]);
      return { node: { type: "not", child: k[0]! }, size: sz };
    }
    case T.kofn:
      return { node: { type: "kofn", k: r.u(b, 1), children: kids(b + 1) }, size: sz };
    case T.exactly:
      return { node: { type: "exactly", k: r.u(b, 1), children: kids(b + 1) }, size: sz };
    case T.cmp:
      return leaf({ type: "cmp", source: decodeSource(r, b), op: OPS[r.u(b + 64, 1)] ?? ("?" as Op), value: r.w(b + 65) }, 97);
    case T.range:
      return leaf({ type: "range", source: decodeSource(r, b), lo: r.w(b + 64), hi: r.w(b + 96), ...(r.u(b + 128, 1) === 1 ? { outside: true } : {}) }, 129);
    case T.crossing:
      return leaf({ type: "crossing", source: decodeSource(r, b), line: r.w(b + 64), dir: DIRS[r.u(b + 96, 1)] ?? ("?" as Dir), initial: r.w(b + 97), slot: r.u(b + 129, 1) }, 130);
    case T.delta:
      return leaf({ type: "delta", source: decodeSource(r, b), bps: r.u(b + 64, 4), dir: DIRS[r.u(b + 68, 1)] ?? ("?" as Dir), initial: r.w(b + 69), slot: r.u(b + 101, 1) }, 102);
    case T.ratio:
      return leaf({ type: "ratio", a: decodeSource(r, b), b: decodeSource(r, b + 64), op: OPS[r.u(b + 128, 1)] ?? ("?" as Op), num: r.w(b + 129), den: r.w(b + 161) }, 193);
    case T.codeHash:
      return leaf({ type: "codeHash", account: getAddress(r.hex(b, 20)), recorded: r.hex(b + 20, 32), ...(r.u(b + 52, 1) === 1 ? { unchanged: true } : {}) }, 53);
    case T.predicate: {
      const pl = r.u(b + 24, 2);
      return leaf({ type: "predicate", target: getAddress(r.hex(b, 20)), gas: r.u(b + 20, 4), params: r.hex(b + 26, pl) }, 26 + pl);
    }
    case T.const:
      return leaf({ type: "const", value: r.u(b, 1) === 1 }, 1);
    default:
      throw new RuleSetInvalid([`unknown node type ${t} at byte ${p}`]);
  }
}

/** Reads a config back into a spec. Strict: the result re-encodes to the same bytes or this throws. */
export function decodeRuleSet(config: Hex): RuleSetSpec {
  const r = new Reader(config);
  if (r.u(0, 1) !== 1) throw new RuleSetInvalid(["unsupported config version"]);
  const mode = r.u(1, 1);
  if (mode > 1) throw new RuleSetInvalid(["bad mode"]);
  const n = r.u(2, 1);
  const rules: RuleSpec[] = [];
  for (let i = 0; i < n; i++) {
    const rec = HEADER + 16 * i;
    const maxFires = r.u(rec, 2);
    const treeOff = r.u(rec + 4, 2);
    const at = r.u(rec + 6, 1);
    const retry = r.u(rec + 7, 1);
    if (retry > 1) throw new RuleSetInvalid(["retry byte must be 0 or 1"]);
    const actionOff = r.u(rec + 8, 2);
    const actionLen = r.u(rec + 10, 2);
    const actionGas = r.u(rec + 12, 4);
    const { node } = decodeNode(r, treeOff);
    const action: Action = at === 1 ? { type: "call", target: getAddress(r.hex(actionOff, 20)), value: r.w(actionOff + 20), data: r.hex(actionOff + 52, actionLen - 52), gas: actionGas } : { type: "none" };
    rules.push({ when: node, maxFires, action, retryOnFailure: retry === 1 });
  }
  const spec: RuleSetSpec = { mode: mode === 1 ? "else" : "independent", rules };
  const issues = validateRuleSet(spec);
  if (issues.length) throw new RuleSetInvalid(issues);
  if (encodeUnchecked(spec).toLowerCase() !== config.toLowerCase()) throw new RuleSetInvalid(["config is not in canonical form (it does not re-encode to the same bytes)"]);
  return spec;
}

/** Validates raw config bytes the way the logic's constructor does. Returns the issues (empty = accepted). */
export function validateConfig(config: Hex): string[] {
  try {
    decodeRuleSet(config);
    return [];
  } catch (e) {
    return e instanceof RuleSetInvalid ? e.issues : [String(e)];
  }
}

export { isStateful };
