// Shared vectors for the rule-set config format: the same specs are built by the SDK encoder (here) and by the Solidity
// builders (contracts/test/RuleSetCodec.t.sol); both must produce these exact bytes, and both validators must agree on the
// invalid ones. Regenerate the fixture with `bun packages/sdk/scripts/gen-ruleset-vectors.ts`.
import { toFunctionSelector, type Hex } from "viem";
import { encodeRuleSetUnchecked } from "../src/ruleset/encode.ts";
import { always, and, callAction, codeChanged, compare, crossing, delta, erc20, ethBalance, exactlyK, exactlyOne, getter, inRange, kOfN, not, or, predicate, ratio, ruleSet, stateFlag, storage, type Node, type RuleSetSpec } from "../src/ruleset/spec.ts";

export const A1 = "0x00000000000000000000000000000000000a0001" as const;
export const A2 = "0x00000000000000000000000000000000000a0002" as const;
export const A3 = "0x00000000000000000000000000000000000a0003" as const;
export const SEL = toFunctionSelector("value()");
const H32 = `0x${"ab".repeat(32)}` as Hex;

export const VALID: { name: string; spec: RuleSetSpec }[] = [
  { name: "const", spec: ruleSet("independent", { when: always(true), maxFires: 1 }) },
  {
    name: "and + call action",
    spec: ruleSet("independent", { when: and(compare(getter(A1, SEL, { gas: 30_000 }), "gt", 5n), inRange(storage(H32), 1n, 9n)), maxFires: 0, action: callAction(A2, { value: 7n, data: "0xdeadbeef", gas: 90_000 }) }),
  },
  {
    name: "or / not / k-of-n nested",
    spec: ruleSet("independent", {
      when: or(not(kOfN(2, compare(getter(A1, SEL, { arg: "self", gas: 20_000 }), "le", 3n), stateFlag(A2, SEL, true, 25_000), always(false))), and(always(true), always(false))),
      maxFires: 3,
    }),
  },
  {
    name: "stateful and arithmetic leaves",
    spec: ruleSet("independent", {
      when: and(
        crossing(getter(A1, SEL, { arg: H32 }), 100n, "either", { initial: 50n, slot: 3 }),
        delta(erc20(A2, "self", 40_000), 1500, "down", { initial: 1000n, slot: 3 }),
        ratio(ethBalance(A3), erc20(A1, A3, 35_000), "ge", 3n, 2n),
        compare(ethBalance("self"), "ne", 0n),
      ),
      maxFires: 2,
    }),
  },
  { name: "predicate and code hash", spec: ruleSet("independent", { when: or(predicate(A1, { params: "0x0102030405", gas: 120_000, maxWitnessBytes: 64 }), codeChanged(A2, H32)), maxFires: 1 }) },
  {
    name: "else mode, three rules",
    spec: ruleSet(
      "else",
      { when: compare(getter(A1, SEL), "gt", 100n), maxFires: 1, action: callAction(A2, { data: "0x12345678", gas: 50_000 }) },
      { when: compare(getter(A1, SEL), "gt", 10n), maxFires: 1 },
      { when: always(true), maxFires: 1, action: callAction(A3, { gas: 60_000 }) },
    ),
  },
  {
    name: "exactly one of",
    spec: ruleSet("independent", { when: exactlyOne(compare(getter(A1, SEL, { gas: 30_000 }), "gt", 5n), stateFlag(A2, SEL, true, 25_000), always(false)), maxFires: 1 }),
  },
];

const many = (n: number): Node[] => Array.from({ length: n }, () => always(true));
const nots = (n: number): Node => Array.from({ length: n }).reduce<Node>((x) => not(x), always(true));

/** Invalid configs (built unchecked in TS): both validators must refuse every one. */
export const INVALID: { name: string; config: () => Hex }[] = [
  { name: "68 nodes", config: () => encodeRuleSetUnchecked(ruleSet("independent", { when: and(and(...many(16)), and(...many(16)), and(...many(16)), and(...many(15))) })) },
  { name: "depth 9", config: () => encodeRuleSetUnchecked(ruleSet("independent", { when: nots(8) })) },
  { name: "17 children", config: () => encodeRuleSetUnchecked(ruleSet("independent", { when: and(...many(17)) })) },
  { name: "k above n", config: () => encodeRuleSetUnchecked(ruleSet("independent", { when: kOfN(3, ...many(2)) })) },
  { name: "17 rules", config: () => encodeRuleSetUnchecked(ruleSet("independent", ...Array.from({ length: 17 }, () => ({ when: always(true) })))) },
  { name: "predicate under NOT", config: () => encodeRuleSetUnchecked(ruleSet("independent", { when: not(predicate(A1, { maxWitnessBytes: 0 })) })) },
  { name: "predicate in an earlier else tree", config: () => encodeRuleSetUnchecked(ruleSet("else", { when: predicate(A1, { maxWitnessBytes: 0 }) }, { when: always(true) })) },
  { name: "getter without a gas cap", config: () => encodeRuleSetUnchecked(ruleSet("independent", { when: compare(getter(A1, SEL, { gas: 0 }), "gt", 1n) })) },
  { name: "delta 0 bps", config: () => encodeRuleSetUnchecked(ruleSet("independent", { when: delta(getter(A1, SEL), 0, "up", { initial: 0n }) })) },
  { name: "range lo above hi", config: () => encodeRuleSetUnchecked(ruleSet("independent", { when: inRange(getter(A1, SEL), 9n, 1n) })) },
  { name: "ratio den 0", config: () => encodeRuleSetUnchecked(ruleSet("independent", { when: ratio(getter(A1, SEL), getter(A2, SEL), "gt", 1n, 0n) })) },
  { name: "empty", config: () => "0x" },
  { name: "trailing byte", config: () => `${encodeRuleSetUnchecked(VALID[0]!.spec)}00` as Hex },
  { name: "bad version", config: () => `0x02${encodeRuleSetUnchecked(VALID[0]!.spec).slice(4)}` as Hex },
  { name: "truncated", config: () => encodeRuleSetUnchecked(VALID[1]!.spec).slice(0, -8) as Hex },
  { name: "exactly: k above n", config: () => encodeRuleSetUnchecked(ruleSet("independent", { when: exactlyK(3, ...many(2)) })) },
  { name: "predicate under exactly one", config: () => encodeRuleSetUnchecked(ruleSet("independent", { when: exactlyOne(predicate(A1, { maxWitnessBytes: 0 }), always(true)) })) },
  { name: "params over 1024", config: () => encodeRuleSetUnchecked(ruleSet("independent", { when: predicate(A1, { params: `0x${"cd".repeat(1025)}`, maxWitnessBytes: 0 }) })) },
];
