// The SDK's blocks (no Solidity): each one is the rule-set node it says it is, joins keep the fail-closed rules, and whole
// builds validate, encode and plan.
import { concatHex, padHex, toFunctionSelector, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { blocks, bountyClaim, bountyWatch } from "../src/index.ts";
import { decodeRuleSet, encodeRuleSet, validateRuleSet } from "../src/ruleset/encode.ts";
import { planRuleSet } from "../src/ruleset/deploy.ts";

const A = "0x00000000000000000000000000000000000a0001" as Address;
const B = "0x00000000000000000000000000000000000a0002" as Address;
const C = "0x00000000000000000000000000000000000a0003" as Address;
const H = `0x${"ab".repeat(32)}` as Hex;
const { getter, valueCrossesLine, valueOutsideBand, ratioCrossesLine, valueMovesTooFast, contractCodeChanged, signedInstruction, reportersSigned } = blocks;
const { allOf, anyOf, noneOf, atLeast, exactlyOne, exactly, makeACall, pauseTarget, nothing, build, buildIfElse, always } = blocks;

describe("check blocks are the nodes they name", () => {
  const price = getter(A, "price()");
  it("value crosses a line, band, ratio", () => {
    expect(valueCrossesLine(price, "above", 5n)).toEqual({ type: "cmp", source: price, op: "gt", value: 5n });
    expect(valueCrossesLine(price, "below", 5n)).toMatchObject({ op: "lt" });
    expect(valueOutsideBand(price, 1n, 9n)).toEqual({ type: "range", source: price, lo: 1n, hi: 9n, outside: true });
    expect(ratioCrossesLine(price, getter(B, "price()"), "below", 99n, 100n)).toMatchObject({ type: "ratio", op: "lt", num: 99n, den: 100n });
  });
  it("value moves too fast, code changed", () => {
    expect(valueMovesTooFast(price, 2_000, "down", { initial: 7n })).toMatchObject({ type: "delta", bps: 2_000, dir: "down", initial: 7n });
    expect(contractCodeChanged(A, H)).toEqual({ type: "codeHash", account: A, recorded: H });
  });
  it("signed instruction and reporters are predicates with the signer's params", () => {
    expect(signedInstruction(A, "0x1234", { maxWitnessBytes: 65 })).toEqual({ type: "predicate", target: A, params: "0x1234", maxWitnessBytes: 65 });
    const r = reportersSigned(A, H, 2, [B, C]);
    // AttestedFactSigner's params: statement ++ k ++ n ++ n addresses (src/signers/AttestedFactSigner.sol)
    expect(r).toMatchObject({ type: "predicate", target: A, maxWitnessBytes: 132 });
    expect((r as { params: Hex }).params.toLowerCase()).toBe(concatHex([H, "0x02", "0x02", B, C]).toLowerCase());
  });
});

describe("joins", () => {
  const x = always(true);
  const y = always(false);
  it("map onto and / or / not / k-of-n / exactly", () => {
    expect(allOf(x, y)).toEqual({ type: "and", children: [x, y] });
    expect(anyOf(x, y)).toEqual({ type: "or", children: [x, y] });
    expect(noneOf(x)).toEqual({ type: "not", child: x });
    expect(noneOf(x, y)).toEqual({ type: "not", child: { type: "or", children: [x, y] } });
    expect(atLeast(2, x, y, x)).toEqual({ type: "kofn", k: 2, children: [x, y, x] });
    expect(exactlyOne(x, y)).toEqual({ type: "exactly", k: 1, children: [x, y] });
    expect(exactly(2, x, y, x)).toEqual({ type: "exactly", k: 2, children: [x, y, x] });
  });
  it("a signed instruction cannot sit under None Of or Exactly One Of (its no only means the signature failed)", () => {
    const sig = signedInstruction(A, "0x", { maxWitnessBytes: 65 });
    expect(validateRuleSet(build({ when: noneOf(sig) })).join()).toMatch(/predicate cannot be used under NOT or exactly-k/);
    expect(validateRuleSet(build({ when: exactlyOne(sig, x) })).join()).toMatch(/predicate cannot be used under NOT or exactly-k/);
    expect(validateRuleSet(build({ when: anyOf(sig, x) }))).toEqual([]);
  });
});

describe("actions and builds", () => {
  it("pause the target calls pause(); make a call carries its data", () => {
    expect(pauseTarget(A)).toEqual({ type: "call", target: A, data: toFunctionSelector("pause()"), gas: 100_000 });
    expect(makeACall(B, { data: "0xdeadbeef", value: 3n })).toEqual({ type: "call", target: B, data: "0xdeadbeef", value: 3n });
    expect(nothing()).toEqual({ type: "none" });
  });

  it("an oracle-disagreement build validates, round-trips and needs a stake (it reads other contracts)", () => {
    const spec = build({
      name: "oracle disagreement",
      when: allOf(
        anyOf(ratioCrossesLine(getter(A, "price()"), getter(B, "price()"), "below", 95n, 100n), ratioCrossesLine(getter(A, "price()"), getter(B, "price()"), "above", 105n, 100n)),
        noneOf(valueCrossesLine(getter(C, "paused()"), "above", 0n)),
      ),
      then: pauseTarget(C),
    });
    expect(validateRuleSet(spec)).toEqual([]);
    const c = encodeRuleSet(spec);
    expect(encodeRuleSet(decodeRuleSet(c))).toBe(c);
    expect(spec.rules[0]).toMatchObject({ maxFires: 1, action: { type: "call", target: C } });
    expect(planRuleSet(spec).classes[0]!.unstaked).toBe(false);
  });

  it("if / else and unlimited fires", () => {
    const s = buildIfElse({ when: valueCrossesLine(getter(A, "v()"), "above", 100n), then: makeACall(B), fires: "unlimited" }, { when: always(true) });
    expect(s.mode).toBe("else");
    expect(s.rules.map((r) => r.maxFires)).toEqual([0, 1]);
    expect(validateRuleSet(s)).toEqual([]);
  });
});

describe("example build triggers", () => {
  it("proof-of-exploit claim is (recipient, uint64 claim id) + the proof; the watch is one address", () => {
    const c = bountyClaim(A, 1n, "0x1234");
    expect(c.triggerData).toBe(concatHex([padHex(A, { size: 32 }), padHex("0x01", { size: 32 })]));
    expect(c.verifyData).toBe("0x1234");
    expect(bountyWatch(B)).toEqual({ triggerData: padHex(B, { size: 32 }), verifyData: "0x" });
  });
});
