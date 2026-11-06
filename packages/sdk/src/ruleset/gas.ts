// Worst-case gas of a rule's condition (VERIFY, `__condition`) and action, for sizing conditionGas, maxGasPerFrame and
// maxStateGasPerFrame. Worst case = every external read burns its whole per-node cap, every non-short-circuited child runs,
// and the triggerer picks the most expensive OR child. The constants are MEASURED:
// `RULESET_GAS_MODEL` records where each came from. Reads of the same address twice are priced cold both times (conservative).
import { size } from "viem";
import { STATE_SLOT_GAS } from "../ruleContract.ts";
import { assignSlots, childrenOf, layoutRuleSet } from "./encode.ts";
import { DEFAULT_CALL_GAS, DEFAULT_PREDICATE_GAS, DEFAULT_READ_GAS, type Node, type RuleSetSpec, type Source } from "./spec.ts";

export const RULESET_GAS_MODEL = {
  /** Fixed part of `__condition`: dispatch, triggerData decode, config EXTCODECOPY (cold), epoch SLOAD (cold), witness check, keccak. */
  base: 8_000,
  /** Per config byte copied by EXTCODECOPY and kept in memory. */
  perConfigByte: 2,
  /** Evaluating any node (dispatch, header reads, tri-state bookkeeping). */
  node: 1_350,
  /** Extra per value leaf (source decode, comparison, tri-state). Measured: and16 of storage leaves on one slot = 2,270 per leaf. */
  leaf: 900,
  /** Per sibling skipped to reach the OR child the hint names (measured: 15 hops = about 7,400). */
  hop: 600,
  /** cold CALL overhead outside the callee's cap (account access + calldata + return copy). */
  call: 3_300,
  /** own-storage read (cold SLOAD + decode). */
  sload: 2_300,
  /** BALANCE / SELFBALANCE of a cold account. */
  ethBalance: 2_800,
  /** EXTCODEHASH of a cold account. */
  codeHash: 2_900,
  /** 512-bit comparison work of ratio / delta. */
  arith: 400,
  /** checkpoint SLOAD of crossing/delta (cold). */
  checkpoint: 2_300,
  /** per byte of params + witness + context passed to a predicate (memory + calldata copy). */
  predicateByte: 8,
  predicateFixed: 1_500,
  /** else mode: the epoch/maxFires lookups are per rule only for the named rule. */
  /** margin applied by planRuleSet on top of the worst case. */
  margin: 1.1,
  /** action: fixed (config read, epoch SSTORE warm-after-SLOAD, event). */
  actionBase: 30_000,
  /** action: per stateful leaf (read + SSTORE). */
  actionPerCheckpoint: 12_000,
} as const;

const M = RULESET_GAS_MODEL;

function sourceCost(s: Source): number {
  if (s.kind === "storage") return M.sload;
  if (s.kind === "ethBalance") return M.ethBalance;
  return M.call + (s.gas ?? DEFAULT_READ_GAS);
}

/** Worst-case gas of a subtree. exact: evaluated exactly (under NOT / earlier else tree): ORs run every child. */
function worstNode(n: Node, exact: boolean): number {
  switch (n.type) {
    case "const":
      return M.node;
    case "cmp":
    case "range":
      return M.node + M.leaf + sourceCost(n.source);
    case "crossing":
    case "delta":
      return M.node + M.leaf + sourceCost(n.source) + M.checkpoint + M.arith;
    case "ratio":
      return M.node + M.leaf + sourceCost(n.a) + sourceCost(n.b) + M.arith;
    case "codeHash":
      return M.node + M.leaf + M.codeHash;
    case "predicate":
      return M.node + M.call + (n.gas ?? DEFAULT_PREDICATE_GAS) + M.predicateFixed + M.predicateByte * (size(n.params ?? "0x") + (n.maxWitnessBytes ?? 0) + 96);
    case "not":
      return M.node + worstNode(n.child, true);
    case "and":
    case "kofn":
      return M.node + n.children.reduce((a, c) => a + worstNode(c, exact), 0);
    case "exactly":
      return M.node + n.children.reduce((a, c) => a + worstNode(c, true), 0);
    case "or": {
      const w = n.children.map((c) => worstNode(c, exact));
      return M.node + (exact ? w.reduce((a, b) => a + b, 0) : Math.max(...w) + M.hop * (n.children.length - 1) + 200);
    }
  }
}

export interface RuleGas {
  ruleId: number;
  /** Worst-case `__condition` gas for a trigger of this rule (earlier trees of an else set included). */
  condition: number;
  /** Worst-case `__action` gas (checkpoint updates, the CALL action's cap, bookkeeping). */
  action: number;
  /** Fresh storage slots the action can write for the first time (epoch + checkpoints), times 97,920 = state gas. */
  freshSlots: number;
  stateGas: bigint;
}

export function estimateRuleGas(spec: RuleSetSpec, configBytes: number): RuleGas[] {
  const layout = layoutRuleSet(spec);
  const slots = assignSlots(spec);
  return spec.rules.map((r, ruleId) => {
    let condition = M.base + M.perConfigByte * configBytes + worstNode(r.when, false);
    if (spec.mode === "else") for (let i = 0; i < ruleId; i++) condition += worstNode(spec.rules[i]!.when, true);
    // checkpoint reads in the action: every crossing/delta source once
    let stateful = 0;
    let readCost = 0;
    const walk = (n: Node) => {
      if (n.type === "crossing" || n.type === "delta") {
        stateful++;
        readCost += sourceCost(n.source);
      }
      childrenOf(n).forEach(walk);
    };
    walk(r.when);
    const a = r.action ?? { type: "none" as const };
    const action = M.actionBase + stateful * M.actionPerCheckpoint + readCost + (a.type === "call" ? M.call + (a.gas ?? DEFAULT_CALL_GAS) : 0);
    const distinctSlots = new Set<number>();
    const collect = (n: Node) => {
      if (n.type === "crossing" || n.type === "delta") distinctSlots.add(slots.get(n)!);
      childrenOf(n).forEach(collect);
    };
    collect(r.when);
    const freshSlots = 1 + distinctSlots.size + (a.type === "call" ? (a.stateSlots ?? 0) : 0);
    void layout;
    return { ruleId, condition, action, freshSlots, stateGas: BigInt(freshSlots) * STATE_SLOT_GAS };
  });
}
