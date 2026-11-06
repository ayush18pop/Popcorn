// Rule-set specification types and the typed builder. A RuleSetSpec is what a developer or a UI edits; encode.ts
// turns it into the config bytes RuleSetContract (contracts/src/rules) evaluates, decode.ts reads them back.
import { toFunctionSelector, type Address, type Hex } from "viem";

export type Op = "gt" | "ge" | "lt" | "le" | "eq" | "ne";
export type Dir = "up" | "down" | "either";

/** What a value leaf reads. `gas` is the per-read STATICCALL cap (default 30,000): a read over it is "unknown". */
export type Source =
  | { kind: "storage"; slot: Hex }
  | { kind: "getter"; target: Address; selector: Hex; arg?: Hex | "self"; gas?: number }
  | { kind: "ethBalance"; account: Address | "self" }
  | { kind: "erc20"; token: Address; account: Address | "self"; gas?: number };

export type Node =
  | { type: "and"; children: Node[] }
  | { type: "or"; children: Node[] }
  | { type: "not"; child: Node }
  | { type: "kofn"; k: number; children: Node[] }
  /** Exactly k children are true (Exactly One Of: k = 1). Children are evaluated exactly, so no predicate below it. */
  | { type: "exactly"; k: number; children: Node[] }
  | { type: "cmp"; source: Source; op: Op; value: bigint }
  | { type: "range"; source: Source; lo: bigint; hi: bigint; outside?: boolean }
  /**
   * `initial` is REQUIRED: the baseline used until the first trigger writes a checkpoint (set it to the value you want to measure
   * from, usually the current value). A silent default of 0 would make an up/either delta fire on the first trigger for any
   * value > 0 and a crossing fire at once (up) or never (down).
   * `slot`: checkpoint slot (0-255); leaves naming the same slot share one baseline. Default: a unique slot per leaf.
   */
  | { type: "crossing"; source: Source; line: bigint; dir: Dir; initial: bigint; slot?: number }
  | { type: "delta"; source: Source; bps: number; dir: Dir; initial: bigint; slot?: number }
  | { type: "ratio"; a: Source; b: Source; op: Op; num: bigint; den: bigint }
  | { type: "codeHash"; account: Address; recorded: Hex; unchanged?: boolean }
  /**
   * `maxWitnessBytes` is SDK metadata (not encoded): the largest witness the predicate takes. It sizes maxVerifyDataLength
   * and the gas estimate; leave it out and the planner assumes 0, so a trigger carrying a witness is refused (planRuleSet warns).
   */
  | { type: "predicate"; target: Address; params?: Hex; gas?: number; maxWitnessBytes?: number }
  | { type: "const"; value: boolean };

/**
 * `call`: best effort, gas = min(`gas`, what the frame can afford minus a reserve). `stateSlots` is SDK metadata: fresh storage
 * slots the callee writes (each costs 97,920 state gas out of the rule contract's maxStateGasPerFrame, see L5).
 */
export type Action = { type: "none" } | { type: "call"; target: Address; value?: bigint; data?: Hex; gas?: number; stateSlots?: number };

export interface RuleSpec {
  /** Free text for UIs and reports (not encoded). */
  name?: string;
  when: Node;
  /** 0 = unlimited (the rule re-arms with a new key each time it fires). Default 1: fire once. Counts fires, not triggers (see retryOnFailure). */
  maxFires?: number;
  /**
   * CALL actions only. true: a failed CALL does not count toward maxFires (the rule can be triggered again with a fresh key, so a
   * triggerer cannot use a one-shot rule up by timing a trigger for when the callee fails; a callee that keeps failing lets anyone
   * keep making the rule contract pay for triggers while the condition is true). false: every trigger counts. Default: true for a call action.
   */
  retryOnFailure?: boolean;
  action?: Action;
}

export interface RuleSetSpec {
  /** "independent": a rule fires when its tree is true. "else": and every earlier tree is definitely false. */
  mode: "independent" | "else";
  rules: RuleSpec[];
}

export const DEFAULT_READ_GAS = 30_000;
export const DEFAULT_PREDICATE_GAS = 100_000;
export const DEFAULT_CALL_GAS = 100_000;

// ---------------------------------------------------------------- builder

const sel = (s: Hex | string): Hex => (s.startsWith("0x") && s.length === 10 ? (s as Hex) : toFunctionSelector(s));

export const and = (...children: Node[]): Node => ({ type: "and", children });
export const or = (...children: Node[]): Node => ({ type: "or", children });
export const not = (child: Node): Node => ({ type: "not", child });
export const kOfN = (k: number, ...children: Node[]): Node => ({ type: "kofn", k, children });
export const exactlyK = (k: number, ...children: Node[]): Node => ({ type: "exactly", k, children });
export const exactlyOne = (...children: Node[]): Node => exactlyK(1, ...children);
export const always = (value = true): Node => ({ type: "const", value });

/** A getter on another contract (STATICCALL, `selector` as "name()" or 0x-4 bytes). */
export const getter = (target: Address, selector: Hex | string, o: { arg?: Hex | "self"; gas?: number } = {}): Source => ({
  kind: "getter",
  target,
  selector: sel(selector),
  ...(o.arg !== undefined ? { arg: o.arg } : {}),
  ...(o.gas !== undefined ? { gas: o.gas } : {}),
});
export const storage = (slot: Hex): Source => ({ kind: "storage", slot });
export const ethBalance = (account: Address | "self"): Source => ({ kind: "ethBalance", account });
export const erc20 = (token: Address, account: Address | "self", gas?: number): Source => ({ kind: "erc20", token, account, ...(gas !== undefined ? { gas } : {}) });

export const compare = (source: Source, op: Op, value: bigint): Node => ({ type: "cmp", source, op, value });
export const above = (source: Source, value: bigint): Node => compare(source, "gt", value);
export const below = (source: Source, value: bigint): Node => compare(source, "lt", value);
export const inRange = (source: Source, lo: bigint, hi: bigint): Node => ({ type: "range", source, lo, hi });
export const outOfRange = (source: Source, lo: bigint, hi: bigint): Node => ({ type: "range", source, lo, hi, outside: true });
export const crossing = (source: Source, line: bigint, dir: Dir, o: { initial: bigint; slot?: number }): Node => ({ type: "crossing", source, line, dir, ...o });
export const delta = (source: Source, bps: number, dir: Dir, o: { initial: bigint; slot?: number }): Node => ({ type: "delta", source, bps, dir, ...o });
export const ratio = (a: Source, b: Source, op: Op, num: bigint, den: bigint): Node => ({ type: "ratio", a, b, op, num, den });
export const codeChanged = (account: Address, recorded: Hex): Node => ({ type: "codeHash", account, recorded });
export const codeUnchanged = (account: Address, recorded: Hex): Node => ({ type: "codeHash", account, recorded, unchanged: true });
/** A bool or enum getter equal to `value` (true = 1). */
export const stateFlag = (target: Address, selector: Hex | string, value: boolean | number | bigint = true, gas?: number): Node =>
  compare(getter(target, selector, gas !== undefined ? { gas } : {}), "eq", typeof value === "boolean" ? (value ? 1n : 0n) : BigInt(value));
export const predicate = (target: Address, o: { maxWitnessBytes: number; params?: Hex; gas?: number }): Node => ({ type: "predicate", target, ...o });

export const callAction = (target: Address, o: { value?: bigint; data?: Hex; gas?: number; stateSlots?: number } = {}): Action => ({ type: "call", target, ...o });
export const ruleSet = (mode: RuleSetSpec["mode"], ...rules: RuleSpec[]): RuleSetSpec => ({ mode, rules });
