// Blocks without Solidity. Checks, joins and call actions are plugged together as data and deployed on the shared, reviewed
// rule-set engine (contracts/src/rules): no compiler, one small published config per build.
//
//   import { blocks, deployRuleSet } from "@popcorn/sdk";
//   const { build, anyOf, valueCrossesLine, reportersSigned, pauseTarget, getter } = blocks;
//   const spec = build({ name: "oracle disagreement", when: anyOf(valueCrossesLine(getter(oracle, "price()"), "below", floor), reportersSigned(...)), then: pauseTarget(pool) });
//   const { ruleContract } = await deployRuleSet(client.popcorn, spec, { fund, stake: true });
//
// The same blocks exist in Solidity (contracts/src/blocks), with the same names and the same yes / no / unknown rules. The
// blocks that keep state of their own (Pay The Reward, Anonymous Group Vote, Hand Over To A New Key, Switch To Quantum-Safe
// Only, Exit To An Address, Repay A Loan, Pause The Target on itself) are Solidity only: inherit them in a build.
import { encodePacked, toFunctionSelector, type Address, type Hex } from "viem";
import * as rs from "./ruleset/spec.ts";

/** A check block: answers yes, no or unknown. Unknown never fires. */
export type Check = rs.Node;
/** An action block that needs no state of its own: one call, best effort. */
export type Action = rs.Action;

export interface BlockRule {
  /** Free text for reports and the explorer. */
  name?: string;
  /** The check (or a join of checks) that must say yes. */
  when: Check;
  /** What happens then. Default: nothing (a build that only records that the check held). */
  then?: Action;
  /** How many times this rule may fire. Default 1; "unlimited" re-arms it with a new key after every fire. */
  fires?: number | "unlimited";
  /** For a call action: a failed call does not use up a fire (default true). */
  retryOnFailure?: boolean;
}

// ---------------------------------------------------------------- where a number comes from

/** A getter on another contract, e.g. getter(pool, "totalAssets()"). Reading another contract needs a staked build. */
export const getter = rs.getter;
/** A slot of the build's own storage (public mempool). */
export const storage = rs.storage;
export const ethBalance = rs.ethBalance;
export const erc20Balance = rs.erc20;

// ---------------------------------------------------------------- checks

type Side = "above" | "below";

/** Value Crosses A Line: the number is strictly above or below `line`. */
export const valueCrossesLine = (source: rs.Source, side: Side, line: bigint): Check => rs.compare(source, side === "above" ? "gt" : "lt", line);

/** Value Crosses A Line, two lines: the number is outside [lo, hi] (a band, a peg). */
export const valueOutsideBand = (source: rs.Source, lo: bigint, hi: bigint): Check => rs.outOfRange(source, lo, hi);

/** Value Crosses A Line, as a ratio: a / b is strictly above or below num / den, compared without division (share price,
 *  two oracles' disagreement). */
export const ratioCrossesLine = (a: rs.Source, b: rs.Source, side: Side, num: bigint, den: bigint): Check => rs.ratio(a, b, side === "above" ? "gt" : "lt", num, den);

/** Value Crosses A Line, once per crossing: yes only when the number crossed the line since the last time this rule fired. */
export const valueCrossedLineSinceLastTime = (source: rs.Source, line: bigint, direction: "up" | "down" | "either", o: { initial: bigint; slot?: number }): Check =>
  rs.crossing(source, line, direction, o);

/** Value Moves Too Fast: the number moved more than `bps` basis points from where it was when the rule last fired.
 *  `initial` is the value to measure from until then (usually the value now). */
export const valueMovesTooFast = (source: rs.Source, bps: number, move: "up" | "down" | "either", o: { initial: bigint; slot?: number }): Check =>
  rs.delta(source, bps, move, o);

/** Contract Code Changed: `account`'s code hash is no longer `recorded` (an upgrade, a new delegation). */
export const contractCodeChanged = (account: Address, recorded: Hex): Check => rs.codeChanged(account, recorded);

/** Signed Instruction, Anyone Can Send: `signer` (any contract in contracts/src/signers) accepts the signature in the trigger's
 *  witness for this build, this rule, its epoch and the exact trigger data. `params` hold the key. */
export const signedInstruction = (signer: Address, params: Hex, o: { maxWitnessBytes: number; gas?: number }): Check =>
  rs.predicate(signer, { params, maxWitnessBytes: o.maxWitnessBytes, ...(o.gas !== undefined ? { gas: o.gas } : {}) });

/** Statement Signed By k Of n Reporters: k of `reporters` signed `statement` for this exact trigger (AttestedFactSigner). */
export const reportersSigned = (attestedFactSigner: Address, statement: Hex, k: number, reporters: Address[], o: { gas?: number } = {}): Check =>
  rs.predicate(attestedFactSigner, {
    params: encodePacked(["bytes32", "uint8", "uint8", ...reporters.map(() => "address" as const)], [statement, k, reporters.length, ...reporters] as never),
    maxWitnessBytes: 66 * k,
    ...(o.gas !== undefined ? { gas: o.gas } : {}),
  });

/** A check that always answers the same (useful in tests and as the last branch of an If / Else). */
export const always = rs.always;

// ---------------------------------------------------------------- joins

/** All Of: yes when every check says yes. */
export const allOf = (...checks: Check[]): Check => rs.and(...checks);
/** Any Of: yes when one check says yes (the sender names which one; a wrong name can only make it no). */
export const anyOf = (...checks: Check[]): Check => rs.or(...checks);
/** None Of: yes when no check says yes. Unknown stays unknown, so a broken read never fires through it. */
export const noneOf = (...checks: Check[]): Check => rs.not(checks.length === 1 ? checks[0]! : rs.or(...checks));
/** At Least k Of n. */
export const atLeast = (k: number, ...checks: Check[]): Check => rs.kOfN(k, ...checks);
/** Exactly One Of. */
export const exactlyOne = (...checks: Check[]): Check => rs.exactlyOne(...checks);
/** Exactly k Of n. */
export const exactly = (k: number, ...checks: Check[]): Check => rs.exactlyK(k, ...checks);

// ---------------------------------------------------------------- actions (no state of their own)

/** Make A Call: one call from the build, best effort (a failed call is reported, never reverted). */
export const makeACall = (target: Address, o: { data?: Hex; value?: bigint; gas?: number; stateSlots?: number } = {}): Action => rs.callAction(target, o);

/** Pause The Target, for a protocol that lets the build call its pause() (grant the build the pauser role). */
export const pauseTarget = (target: Address, o: { gas?: number; stateSlots?: number } = {}): Action =>
  rs.callAction(target, { data: toFunctionSelector("pause()"), gas: o.gas ?? 100_000, ...(o.stateSlots !== undefined ? { stateSlots: o.stateSlots } : {}) });

/** No action: the build only records that the check held (its rule fires and its key moves on). */
export const nothing = (): Action => ({ type: "none" });

// ---------------------------------------------------------------- putting blocks together

const toRule = (r: BlockRule): rs.RuleSpec => ({
  ...(r.name !== undefined ? { name: r.name } : {}),
  when: r.when,
  action: r.then ?? { type: "none" },
  maxFires: r.fires === "unlimited" ? 0 : (r.fires ?? 1),
  ...(r.retryOnFailure !== undefined ? { retryOnFailure: r.retryOnFailure } : {}),
});

/** A build of independent rules: each fires when its own check says yes. Deploy it with deployRuleSet. */
export const build = (...rules: BlockRule[]): rs.RuleSetSpec => rs.ruleSet("independent", ...rules.map(toRule));

/** If / Else: rule i fires only when its check says yes and every earlier check says a definite no. */
export const buildIfElse = (...rules: BlockRule[]): rs.RuleSetSpec => rs.ruleSet("else", ...rules.map(toRule));
