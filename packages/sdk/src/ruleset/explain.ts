// Reading a rule-set rule contract and explaining a trigger per node, through the rule contract's forward path (Core+ forwards ordinary
// calls to the logic; popcornDebug is a `view`, so these are eth_calls that change nothing).
import { decodeFunctionResult, encodeFunctionData, getAddress, type Address, type Hex } from "viem";
/** What the read paths need: a client that can eth_call. A full PopcornContext fits; so does { publicClient } in a browser. */
export interface ReadContext {
  publicClient: { call: (args: { to: Address; data: Hex }) => Promise<{ data?: Hex | undefined }> };
}
import { PopcornError } from "../errors.ts";
import { decodeRuleSet, layoutRuleSet, type NodeInfo } from "./encode.ts";
import type { Node, RuleSetSpec } from "./spec.ts";
import { hintsFromResults, triggerDataFor, type WitnessEntry, encodeWitness } from "./witness.ts";

export const ruleSetAbi = [
  { type: "function", name: "ruleSetConfig", stateMutability: "view", inputs: [], outputs: [{ type: "bytes" }] },
  { type: "function", name: "ruleEpoch", stateMutability: "view", inputs: [{ name: "ruleId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ruleFires", stateMutability: "view", inputs: [{ name: "ruleId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "checkpoint", stateMutability: "view", inputs: [{ name: "slotId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "popcornDebug",
    stateMutability: "view",
    inputs: [
      { name: "ruleId", type: "uint256" },
      { name: "triggerData", type: "bytes" },
      { name: "verifyData", type: "bytes" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "ruleExists", type: "bool" },
          { name: "exhausted", type: "bool" },
          { name: "witnessOk", type: "bool" },
          { name: "wouldPass", type: "bool" },
          { name: "epoch", type: "uint256" },
          { name: "fires", type: "uint256" },
          { name: "nonceKey", type: "uint256" },
          { name: "maxFires", type: "uint256" },
          { name: "mode", type: "uint256" },
          { name: "firstNodeId", type: "uint256" },
          { name: "earlier", type: "bytes" },
          { name: "nodes", type: "bytes" },
        ],
      },
    ],
  },
] as const;

/** A rule contract's rule set, read from its logic (the config lives in the logic's data contract). */
export async function readRuleSet(ctx: ReadContext, ruleContract: Address): Promise<{ config: Hex; spec: RuleSetSpec }> {
  const ret = await ctx.publicClient.call({ to: getAddress(ruleContract), data: encodeFunctionData({ abi: ruleSetAbi, functionName: "ruleSetConfig" }) });
  if (!ret.data) throw new PopcornError(`rule contract ${ruleContract} has no ruleSetConfig(): it is not a RuleSetContract`);
  const config = decodeFunctionResult({ abi: ruleSetAbi, functionName: "ruleSetConfig", data: ret.data });
  return { config, spec: decodeRuleSet(config) };
}

export type NodeVerdict = "true" | "false" | "unknown" | "not evaluated";
const VERDICT: Record<number, NodeVerdict> = { 0: "false", 1: "true", 2: "unknown" };

export interface NodeReport {
  id: number;
  index: number;
  depth: number;
  type: Node["type"];
  /** One-line description of the node ("value of 0xabc.value() > 1000"). */
  label: string;
  result: NodeVerdict;
  raw: number;
  exact: boolean;
}

export interface RuleExplanation {
  ruleId: number;
  ruleExists: boolean;
  /** The rule's epoch (how many triggers ran: the nonce key advances with it) and the nonce key a trigger of it uses now. */
  epoch: bigint;
  /** Triggers that counted toward maxFires (a failed CALL does not count when the rule retries). */
  fires: bigint;
  nonceKey: bigint;
  maxFires: bigint;
  /** fires >= maxFires: the rule is closed. */
  exhausted: boolean;
  witnessOk: boolean;
  /** The exact answer the rule contract's condition gives for these inputs. */
  wouldPass: boolean;
  /** Else mode: results of the earlier rules' trees (a rule fires only if each is false). */
  earlier: { ruleId: number; result: NodeVerdict }[];
  /** Every node of the rule's tree, evaluated in full (no short-circuit, no hint). */
  nodes: NodeReport[];
  /** Nodes that are false or unknown, deepest first: where to look when `wouldPass` is false. */
  blockers: NodeReport[];
  /** OR hints that make the rule pass (a trigger needs them as witness). */
  hints: WitnessEntry[];
  /** Plain text for a terminal or a tooltip. */
  text: string;
}

const srcLabel = (s: import("./spec.ts").Source): string =>
  s.kind === "storage"
    ? `own storage ${s.slot.slice(0, 10)}…`
    : s.kind === "getter"
      ? `${s.target.slice(0, 8)}…${s.selector}()${s.arg === "self" ? " of the rule contract" : s.arg ? ` (${s.arg.slice(0, 10)}…)` : ""}`
      : s.kind === "ethBalance"
        ? `ETH balance of ${s.account === "self" ? "the ruleContract" : s.account.slice(0, 8) + "…"}`
        : `${s.token.slice(0, 8)}… balanceOf(${s.account === "self" ? "the ruleContract" : s.account.slice(0, 8) + "…"})`;

export function nodeLabel(n: Node): string {
  switch (n.type) {
    case "and":
      return `AND of ${n.children.length}`;
    case "or":
      return `OR of ${n.children.length} (triggerer names the true child)`;
    case "not":
      return "NOT";
    case "kofn":
      return `${n.k} of ${n.children.length}`;
    case "exactly":
      return n.k === 1 ? `exactly one of ${n.children.length}` : `exactly ${n.k} of ${n.children.length}`;
    case "cmp":
      return `${srcLabel(n.source)} ${n.op} ${n.value}`;
    case "range":
      return `${srcLabel(n.source)} ${n.outside ? "outside" : "inside"} [${n.lo}, ${n.hi}]`;
    case "crossing":
      return `${srcLabel(n.source)} crossed ${n.dir} line ${n.line} since the last trigger`;
    case "delta":
      return `${srcLabel(n.source)} moved ${n.dir} by ${n.bps / 100}% since the checkpoint`;
    case "ratio":
      return `${srcLabel(n.a)} / ${srcLabel(n.b)} ${n.op} ${n.num}/${n.den}`;
    case "codeHash":
      return `code of ${n.account.slice(0, 8)}… ${n.unchanged ? "unchanged" : "changed"}`;
    case "predicate":
      return `predicate ${n.target.slice(0, 8)}… accepts the witness`;
    case "const":
      return n.value ? "always" : "never";
  }
}

export interface ExplainOptions {
  /** Which rule to explain. */
  ruleId: number;
  /** Default triggerDataFor(ruleId). */
  triggerData?: Hex;
  /** The witness (verifyData) as the trigger would carry it. Default empty: OR nodes then have no hint. */
  verifyData?: Hex;
  /** The rule set, when the caller has it (otherwise it is read from the rule contract). */
  spec?: RuleSetSpec;
}

/**
 * Calls the rule contract's popcornDebug view and maps it onto the rule set: each node's result, the false/unknown nodes that block
 * the rule, the earlier rules of an else set, and the OR hints a trigger needs. Sends nothing.
 */
export async function explainRule(ctx: ReadContext, ruleContract: Address, o: ExplainOptions): Promise<RuleExplanation> {
  const spec = o.spec ?? (await readRuleSet(ctx, ruleContract)).spec;
  const triggerData = o.triggerData ?? triggerDataFor(o.ruleId);
  const data = encodeFunctionData({ abi: ruleSetAbi, functionName: "popcornDebug", args: [BigInt(o.ruleId), triggerData, o.verifyData ?? "0x"] });
  const ret = await ctx.publicClient.call({ to: getAddress(ruleContract), data });
  if (!ret.data) throw new PopcornError(`rule contract ${ruleContract}: popcornDebug returned nothing (not a RuleSetContract?)`);
  const d = decodeFunctionResult({ abi: ruleSetAbi, functionName: "popcornDebug", data: ret.data });
  const layout = layoutRuleSet(spec);
  const lay = layout[o.ruleId];
  const bytes = (h: Hex) => (h.length > 2 ? (h.slice(2).match(/../g) as string[]).map((x) => parseInt(x, 16)) : []);
  const raw = bytes(d.nodes);
  const nodes: NodeReport[] = lay && d.witnessOk ? lay.nodes.map((n: NodeInfo) => ({ id: n.id, index: n.index, depth: n.depth, type: n.node.type, label: nodeLabel(n.node), raw: raw[n.index] ?? 255, result: VERDICT[raw[n.index] ?? 255] ?? "not evaluated", exact: n.exact })) : [];
  const blockers = nodes.filter((n) => n.result !== "true").sort((a, b) => b.depth - a.depth || a.index - b.index);
  const hints = lay && d.witnessOk ? hintsFromResults(spec, o.ruleId, raw) : [];
  const earlier = bytes(d.earlier).map((v, i) => ({ ruleId: i, result: VERDICT[v] ?? ("not evaluated" as NodeVerdict) }));
  const lines: string[] = [];
  lines.push(`rule ${o.ruleId}: ${!d.ruleExists ? "does not exist" : d.wouldPass ? "would pass" : "would NOT pass"} (epoch ${d.epoch}, fires ${d.fires}${d.exhausted ? ", closed: maxFires reached" : ""})`);
  if (d.ruleExists && !d.witnessOk) lines.push("  the witness is malformed (entries must be ascending, in bounds, nothing trailing)");
  for (const e of earlier) lines.push(`  earlier rule ${e.ruleId} tree is ${e.result}${e.result === "false" ? "" : ": an else rule needs every earlier tree to be false"}`);
  for (const n of nodes) lines.push(`  ${"  ".repeat(n.depth - 1)}[${n.id}] ${n.label}: ${n.result}`);
  if (d.ruleExists && d.witnessOk && !d.wouldPass && blockers.length === 0) lines.push("  every node is true: the witness hints are missing or wrong (an OR needs the index of a true child)");
  return {
    ruleId: o.ruleId,
    ruleExists: d.ruleExists,
    epoch: d.epoch,
    fires: d.fires,
    nonceKey: d.nonceKey,
    maxFires: d.maxFires,
    exhausted: d.exhausted,
    witnessOk: d.witnessOk,
    wouldPass: d.wouldPass,
    earlier,
    nodes,
    blockers,
    hints,
    text: lines.join("\n"),
  };
}

/**
 * The witness a trigger of `ruleId` needs right now: the debug view's OR hints. Predicate witnesses (signatures, proofs) are not
 * known here: pass them in `extra`.
 */
export async function witnessFor(ctx: ReadContext, ruleContract: Address, o: { ruleId: number; extra?: WitnessEntry[]; spec?: RuleSetSpec; triggerData?: Hex }): Promise<{ verifyData: Hex; explanation: RuleExplanation }> {
  const first = await explainRule(ctx, ruleContract, { ruleId: o.ruleId, ...(o.spec ? { spec: o.spec } : {}), ...(o.triggerData ? { triggerData: o.triggerData } : {}) });
  const verifyData = encodeWitness([...first.hints, ...(o.extra ?? [])]);
  const explanation = await explainRule(ctx, ruleContract, { ruleId: o.ruleId, verifyData, ...(o.spec ? { spec: o.spec } : {}), ...(o.triggerData ? { triggerData: o.triggerData } : {}) });
  return { verifyData, explanation };
}
