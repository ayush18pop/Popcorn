// Witness (verifyData) and triggerData helpers for rule sets. Layout (RuleSetCodec.sol): entries `nodeId u16 | len u16 | data`,
// node ids strictly ascending, nothing after the last entry. An OR node's entry is one byte: the index of the child the
// triggerer claims is true. A predicate node's entry is whatever that predicate takes (a signature, a proof).
import { concatHex, encodeAbiParameters, keccak256, size, toHex, type Hex } from "viem";
import { RuleSetInvalid, RULESET_LIMITS, layoutRuleSet } from "./encode.ts";
import type { RuleSetSpec } from "./spec.ts";

export interface WitnessEntry {
  /** Global node id (RuleLayout.baseId + preorder index). */
  nodeId: number;
  data: Hex;
}

export function encodeWitness(entries: readonly WitnessEntry[]): Hex {
  const sorted = [...entries].sort((a, b) => a.nodeId - b.nodeId);
  const parts: Hex[] = [];
  let prev = -1;
  for (const e of sorted) {
    if (!Number.isInteger(e.nodeId) || e.nodeId < 0 || e.nodeId >= RULESET_LIMITS.MAX_NODES) throw new RuleSetInvalid([`witness node id ${e.nodeId} outside 0..${RULESET_LIMITS.MAX_NODES - 1}`]);
    if (e.nodeId === prev) throw new RuleSetInvalid([`two witness entries for node ${e.nodeId}`]);
    if (size(e.data) > RULESET_LIMITS.MAX_WITNESS_ENTRY) throw new RuleSetInvalid([`witness entry for node ${e.nodeId} over 65,535 bytes`]);
    prev = e.nodeId;
    parts.push(toHex(e.nodeId, { size: 2 }), toHex(size(e.data), { size: 2 }), e.data);
  }
  return concatHex(parts);
}

export function decodeWitness(w: Hex): WitnessEntry[] {
  const out: WitnessEntry[] = [];
  const total = size(w);
  let pos = 0;
  let prev = -1;
  const num = (o: number, n: number) => Number(BigInt(`0x${w.slice(2 + o * 2, 2 + (o + n) * 2)}`));
  while (pos < total) {
    if (pos + 4 > total) throw new RuleSetInvalid(["witness: truncated entry header"]);
    const id = num(pos, 2);
    const len = num(pos + 2, 2);
    if (pos + 4 + len > total) throw new RuleSetInvalid(["witness: entry runs past the end"]);
    if (id <= prev) throw new RuleSetInvalid(["witness: node ids must be strictly ascending"]);
    out.push({ nodeId: id, data: `0x${w.slice(2 + (pos + 4) * 2, 2 + (pos + 4 + len) * 2)}` as Hex });
    prev = id;
    pos += 4 + len;
  }
  return out;
}

/** The witness entry for an OR node: the index of the child the triggerer says is true. */
export const orHint = (nodeId: number, childIndex: number): WitnessEntry => ({ nodeId, data: toHex(childIndex, { size: 1 }) });

/** triggerData naming a rule: abi.encode(uint256 ruleId). */
export const triggerDataFor = (ruleId: number): Hex => encodeAbiParameters([{ type: "uint256" }], [BigInt(ruleId)]);

/** What an ICondition receives as `context`: abi.encode(ruleId, ruleEpoch, keccak256(triggerData)). */
export const predicateContext = (ruleId: number, epoch: bigint, triggerData: Hex): Hex =>
  encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }], [BigInt(ruleId), epoch, keccak256(triggerData)]);

/**
 * OR hints for a rule from the debug view's node results (0 false, 1 true, 2 unknown, one per node of the rule, preorder):
 * for every OR node, the first child whose result is true. An OR with no true child gets no entry (it is false anyway).
 */
export function hintsFromResults(spec: RuleSetSpec, ruleId: number, results: readonly number[]): WitnessEntry[] {
  const l = layoutRuleSet(spec)[ruleId];
  if (!l) throw new RuleSetInvalid([`no rule ${ruleId}`]);
  const out: WitnessEntry[] = [];
  for (const n of l.nodes) {
    if (n.node.type !== "or") continue;
    const idx = n.children.findIndex((c) => results[c] === 1);
    if (idx >= 0) out.push(orHint(n.id, idx));
  }
  return out;
}
