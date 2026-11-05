// Rule-set offline tests: the rule-set encoder / decoder / validator, witness helpers, gas model structure, rule contract caps, mempool
// classes. No network. (The Solidity side of the format is pinned by contracts/test/RuleSetCodec.t.sol through the same vectors.)
import { readFileSync } from "node:fs";
import { toHex, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { DEFAULT_CORE, checkRuleContractArgsLocal, defaultRuleContractArgs } from "../src/index.ts";
import { RULESET_LIMITS, RuleSetInvalid, assignSlots, decodeRuleSet, encodeRuleSet, encodeRuleSetUnchecked, layoutRuleSet, validateConfig, validateRuleSet } from "../src/ruleset/encode.ts";
import { estimateRuleGas, RULESET_GAS_MODEL } from "../src/ruleset/gas.ts";
import { ruleContractCapsFor, leafClass, planRuleSet, ruleClasses, treeClass } from "../src/ruleset/deploy.ts";
import { decodeWitness, encodeWitness, hintsFromResults, orHint, triggerDataFor, predicateContext } from "../src/ruleset/witness.ts";
import { predictRuleSetInfrastructure } from "../src/ruleset/infra.ts";
import * as rs from "../src/ruleset/spec.ts";
import { INVALID, VALID, A1, A2, SEL } from "./ruleset.vectors.ts";
import { prng } from "./random.ts";

const FIXTURE = new URL("../../../contracts/test/fixtures/ruleset-vectors.json", import.meta.url).pathname;

describe("rule-set format vectors", () => {
  it("the committed fixture is what the encoder produces now (regenerate with scripts/gen-ruleset-vectors.ts)", () => {
    const f = JSON.parse(readFileSync(FIXTURE, "utf8")) as { valid: { name: string; config: Hex }[]; invalid: { name: string; config: Hex }[] };
    expect(f.valid).toEqual(VALID.map((v) => ({ name: v.name, config: encodeRuleSet(v.spec) })));
    expect(f.invalid).toEqual(INVALID.map((v) => ({ name: v.name, config: v.config() })));
  });

  it("every valid vector decodes back to a spec that re-encodes to the same bytes", () => {
    for (const v of VALID) {
      const c = encodeRuleSet(v.spec);
      const d = decodeRuleSet(c);
      expect(encodeRuleSet(d), v.name).toBe(c);
      expect(validateConfig(c), v.name).toEqual([]);
    }
  });

  it("every invalid vector is refused by validateConfig", () => {
    for (const v of INVALID) expect(validateConfig(v.config()).length, v.name).toBeGreaterThan(0);
  });
});

describe("validateRuleSet bounds", () => {
  const T = () => rs.always(true);
  const many = (n: number) => Array.from({ length: n }, T);
  const spec = (when: rs.Node) => rs.ruleSet("independent", { when });
  it("node count, depth, children, rules, k", () => {
    expect(validateRuleSet(spec(rs.and(rs.and(...many(16)), rs.and(...many(16)), rs.and(...many(16)), rs.and(...many(11)))))).toEqual([]); // 3 x 17 + 12 + 1 = 64
    expect(validateRuleSet(spec(rs.and(rs.and(...many(16)), rs.and(...many(16)), rs.and(...many(16)), rs.and(...many(12)))))).toEqual(expect.arrayContaining([expect.stringContaining("65 nodes")]));
    const nest = (n: number) => Array.from({ length: n }).reduce<rs.Node>((x) => rs.not(x), T());
    expect(validateRuleSet(spec(nest(7)))).toEqual([]); // depth 8
    expect(validateRuleSet(spec(nest(8)))[0]).toMatch(/depth 9/);
    expect(validateRuleSet(spec(rs.and(...many(16))))).toEqual([]);
    expect(validateRuleSet(spec(rs.and(...many(17))))[0]).toMatch(/17 children/);
    expect(validateRuleSet(spec(rs.or()))[0]).toMatch(/0 children/);
    expect(validateRuleSet(spec(rs.kOfN(3, T(), T())))[0]).toMatch(/k=3/);
    expect(validateRuleSet(spec(rs.kOfN(0, T(), T())))[0]).toMatch(/k=0/);
    expect(validateRuleSet(rs.ruleSet("independent", ...Array.from({ length: 16 }, () => ({ when: T() }))))).toEqual([]);
    expect(validateRuleSet(rs.ruleSet("independent", ...Array.from({ length: 17 }, () => ({ when: T() }))))[0]).toMatch(/rule count 17/);
    expect(validateRuleSet(rs.ruleSet("independent"))[0]).toMatch(/rule count 0/);
  });

  it("field ranges: gas caps, bps, ratio den, range, params, action data, maxFires", () => {
    const g = (o: { gas?: number } = {}) => rs.getter(A1, SEL, o);
    expect(validateRuleSet(spec(rs.compare(g({ gas: 0 }), "gt", 1n)))[0]).toMatch(/read gas cap 0/);
    expect(validateRuleSet(spec(rs.compare(g({ gas: 2 ** 32 }), "gt", 1n)))[0]).toMatch(/read gas cap/);
    expect(validateRuleSet(spec(rs.compare(g(), "gt", 1n << 256n)))[0]).toMatch(/not a uint256/);
    expect(validateRuleSet(spec(rs.delta(g(), 0, "up", { initial: 0n })))[0]).toMatch(/bps 0/);
    expect(validateRuleSet(spec(rs.delta(g(), 10_001, "down", { initial: 1n })))[0]).toMatch(/more than 100%/);
    expect(validateRuleSet(spec(rs.delta(g(), 10_001, "either", { initial: 1n })))[0]).toMatch(/more than 100%/);
    expect(validateRuleSet(spec(rs.delta(g(), 50_000, "up", { initial: 1n })))).toEqual([]);
    expect(validateRuleSet(spec(rs.ratio(g(), g(), "gt", 1n, 0n)))[0]).toMatch(/den is 0/);
    expect(validateRuleSet(spec(rs.inRange(g(), 5n, 4n)))[0]).toMatch(/lo > hi/);
    expect(validateRuleSet(spec(rs.predicate(A1, { params: `0x${"00".repeat(1024)}`, maxWitnessBytes: 0 })))).toEqual([]);
    expect(validateRuleSet(spec(rs.predicate(A1, { params: `0x${"00".repeat(1025)}`, maxWitnessBytes: 0 })))[0]).toMatch(/params over 1024/);
    expect(validateRuleSet(rs.ruleSet("independent", { when: T(), action: rs.callAction(A1, { data: `0x${"00".repeat(1025)}` }) }))[0]).toMatch(/action data over 1024/);
    expect(validateRuleSet(rs.ruleSet("independent", { when: T(), maxFires: 70_000 }))[0]).toMatch(/maxFires/);
    expect(validateRuleSet(rs.ruleSet("independent", { when: rs.crossing(g(), 1n, "up", { initial: 0n, slot: 256 }) }))[0]).toMatch(/slot/);
  });

  it("the encoded size is bounded by 16 KB", () => {
    const big = (n: number) => rs.predicate(A1, { params: `0x${"ab".repeat(n)}`, maxWitnessBytes: 0 });
    const s = rs.ruleSet("independent", { when: rs.and(...Array.from({ length: 16 }, () => big(1000))) }, { when: rs.and(...Array.from({ length: 16 }, () => big(1000))) });
    expect(validateRuleSet(s).join()).toMatch(/config is \d+ bytes \(max 16384\)/);
    expect(() => encodeRuleSet(s)).toThrow(RuleSetInvalid);
  });

  it("predicates are refused where their result would be used negatively (under NOT, earlier trees of an else set)", () => {
    const p = rs.predicate(A1, { maxWitnessBytes: 0 });
    expect(validateRuleSet(spec(rs.and(T(), p)))).toEqual([]);
    expect(validateRuleSet(spec(rs.or(T(), p)))).toEqual([]);
    expect(validateRuleSet(spec(rs.not(p)))[0]).toMatch(/cannot be used under NOT/);
    expect(validateRuleSet(spec(rs.not(rs.not(p)))).length).toBe(1);
    expect(validateRuleSet(spec(rs.not(rs.and(T(), rs.or(p, T())))))).toHaveLength(1);
    expect(validateRuleSet(rs.ruleSet("else", { when: p }, { when: T() })).length).toBe(1);
    expect(validateRuleSet(rs.ruleSet("else", { when: T() }, { when: p }))).toEqual([]);
    expect(validateRuleSet(rs.ruleSet("independent", { when: p }, { when: p }))).toEqual([]);
  });
});

// ---- random valid specs: encode / decode round trip and layout
function randomSpec(seed: number): rs.RuleSetSpec {
  const r = prng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const big = () => BigInt(Math.floor(r() * 2 ** 40)) * BigInt(Math.floor(r() * 2 ** 40));
  const addr = (): Address => `0x${Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join("")}` as Address;
  const h32 = (): Hex => `0x${Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join("")}` as Hex;
  const src = (): rs.Source =>
    pick<() => rs.Source>([
      () => rs.storage(h32()),
      () => rs.getter(addr(), toHex(Math.floor(r() * 2 ** 32), { size: 4 }), { gas: 1 + Math.floor(r() * 90_000) }),
      () => rs.getter(addr(), toHex(Math.floor(r() * 2 ** 32), { size: 4 }), { arg: "self" }),
      () => rs.getter(addr(), toHex(Math.floor(r() * 2 ** 32), { size: 4 }), { arg: h32() }),
      () => rs.ethBalance("self"),
      () => rs.ethBalance(addr()),
      () => rs.erc20(addr(), "self"),
      () => rs.erc20(addr(), addr(), 1 + Math.floor(r() * 90_000)),
    ])();
  const ops = ["gt", "ge", "lt", "le", "eq", "ne"] as const;
  const dirs = ["up", "down", "either"] as const;
  let budget = 0;
  const node = (depth: number, exact: boolean): rs.Node => {
    budget++;
    const composite = depth < 4 && budget < 20 && r() < 0.5;
    if (composite) {
      const k = pick(["and", "or", "not", "kofn"] as const);
      const n = 1 + Math.floor(r() * 3);
      if (k === "not") return rs.not(node(depth + 1, true));
      const kids = Array.from({ length: n }, () => node(depth + 1, exact));
      return k === "and" ? rs.and(...kids) : k === "or" ? rs.or(...kids) : rs.kOfN(1 + Math.floor(r() * n), ...kids);
    }
    const t = pick(["cmp", "range", "crossing", "delta", "ratio", "code", "const", ...(exact ? [] : ["predicate"])] as const);
    if (t === "cmp") return rs.compare(src(), pick([...ops]), big());
    if (t === "range") { const a = big(); const b = big(); return a < b ? rs.inRange(src(), a, b) : rs.outOfRange(src(), b, a); }
    if (t === "crossing") return rs.crossing(src(), big(), pick([...dirs]), { initial: big(), ...(r() < 0.5 ? { slot: Math.floor(r() * 256) } : {}) });
    if (t === "delta") { const d = pick([...dirs]); return rs.delta(src(), 1 + Math.floor(r() * (d === "up" ? 1_000_000 : 10_000)), d, { initial: big() }); }
    if (t === "ratio") return rs.ratio(src(), src(), pick([...ops]), big(), big() + 1n);
    if (t === "code") return r() < 0.5 ? rs.codeChanged(addr(), h32()) : rs.codeUnchanged(addr(), h32());
    if (t === "predicate") return rs.predicate(addr(), { params: toHex(new Uint8Array(Math.floor(r() * 40)).map(() => Math.floor(r() * 256))), gas: 1 + Math.floor(r() * 200_000), maxWitnessBytes: Math.floor(r() * 100) });
    return rs.always(r() < 0.5);
  };
  const mode = r() < 0.5 ? "else" : "independent";
  const n = 1 + Math.floor(r() * 4);
  return rs.ruleSet(mode, ...Array.from({ length: n }, (_, i) => ({ when: node(1, mode === "else" && i + 1 < n), maxFires: Math.floor(r() * 5), action: r() < 0.5 ? rs.callAction(addr(), { value: big(), data: toHex(new Uint8Array(Math.floor(r() * 30))), gas: 1 + Math.floor(r() * 99_999) }) : { type: "none" as const } })));
}

describe("random valid specs", () => {
  it("encode -> decode -> encode is the identity, the layout numbers nodes in preorder, config is within bounds", () => {
    let checked = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const spec = randomSpec(seed);
      if (validateRuleSet(spec).length) continue; // generator can exceed 64 nodes with 4 rules; those must be refused, never encoded
      const c = encodeRuleSet(spec);
      const d = decodeRuleSet(c);
      expect(encodeRuleSet(d)).toBe(c);
      const lay = layoutRuleSet(d);
      let id = 0;
      for (const l of lay) {
        expect(l.baseId).toBe(id);
        expect(l.nodes.map((n) => n.id)).toEqual(Array.from({ length: l.count }, (_, i) => id + i));
        id += l.count;
      }
      expect(id).toBeLessThanOrEqual(RULESET_LIMITS.MAX_NODES);
      expect((c.length - 2) / 2).toBeLessThanOrEqual(RULESET_LIMITS.MAX_CONFIG);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("any single-byte corruption of a valid config is either refused or decodes to the same canonical config", () => {
    const c = encodeRuleSet(VALID[3]!.spec);
    const hex = c.slice(2);
    let refused = 0;
    for (let i = 0; i < hex.length; i += 2) {
      const flipped = `0x${hex.slice(0, i)}${((parseInt(hex.slice(i, i + 2), 16) ^ 0x40) & 0xff).toString(16).padStart(2, "0")}${hex.slice(i + 2)}` as Hex;
      const issues = validateConfig(flipped);
      if (issues.length) refused++;
      else expect(flipped.toLowerCase()).not.toBe(c.toLowerCase()); // accepted: a different but valid config (a changed constant), never silently equal
    }
    expect(refused).toBeGreaterThan(20);
  });

  it("slots: unique per stateful leaf unless named; leaves naming one slot share it", () => {
    const g = rs.getter(A1, SEL);
    const spec = rs.ruleSet("independent", { when: rs.and(rs.crossing(g, 1n, "up", { initial: 0n }), rs.crossing(g, 2n, "up", { initial: 0n, slot: 0 }), rs.delta(g, 5, "up", { initial: 1n })) }, { when: rs.crossing(g, 3n, "down", { initial: 0n, slot: 1 }) });
    const m = assignSlots(spec);
    const slots = [...m.values()];
    expect(slots).toEqual([2, 0, 3, 1]); // 0 and 1 are taken explicitly; the auto ones skip them
  });
});

describe("witness and triggerData helpers", () => {
  it("encode / decode round trip, ascending order enforced, duplicates and bad ids refused", () => {
    const w = encodeWitness([{ nodeId: 5, data: "0xaabb" }, orHint(2, 1)]);
    expect(w).toBe("0x00020001010005" + "0002" + "aabb");
    expect(decodeWitness(w)).toEqual([orHint(2, 1), { nodeId: 5, data: "0xaabb" }]);
    expect(() => encodeWitness([orHint(2, 0), orHint(2, 1)])).toThrow(/two witness entries/);
    expect(() => encodeWitness([orHint(64, 0)])).toThrow(/outside 0..63/);
    expect(() => decodeWitness("0x0002000101ff")).toThrow(/truncated/);
    expect(() => decodeWitness("0x00030001000002000100")).toThrow(/ascending/);
    expect(() => decodeWitness("0x000200050102")).toThrow(/past the end/);
    expect(encodeWitness([])).toBe("0x");
  });

  it("triggerData and the predicate context", () => {
    expect(triggerDataFor(3)).toBe(`0x${"0".repeat(63)}3` as Hex);
    expect(predicateContext(1, 2n, "0x1234").length).toBe(2 + 96 * 2);
  });

  it("hintsFromResults: the first true child of every OR (global ids)", () => {
    const T = rs.always(true);
    const F = rs.always(false);
    const spec = rs.ruleSet("independent", { when: T }, { when: rs.and(rs.or(F, F, T), rs.or(T, F), rs.or(F, F)) });
    // rule 1: nodes 0 AND, 1 OR, 2 F, 3 F, 4 T, 5 OR, 6 T, 7 F, 8 OR, 9 F, 10 F ; global base 1
    const results = [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0];
    expect(hintsFromResults(spec, 1, results)).toEqual([orHint(2, 2), orHint(6, 0)]);
  });
});

describe("gas model", () => {
  const g = (gas: number) => rs.compare(rs.getter(A1, SEL, { gas }), "gt", 1n);
  const cond = (spec: rs.RuleSetSpec, rule = 0) => estimateRuleGas(spec, 200)[rule]!.condition;
  it("AND sums, OR with a hint takes the most expensive child, OR under NOT sums, k-of-n sums", () => {
    const a = cond(rs.ruleSet("independent", { when: rs.and(g(10_000), g(30_000)) }));
    const o = cond(rs.ruleSet("independent", { when: rs.or(g(10_000), g(30_000)) }));
    const no = cond(rs.ruleSet("independent", { when: rs.not(rs.or(g(10_000), g(30_000))) }));
    const k = cond(rs.ruleSet("independent", { when: rs.kOfN(1, g(10_000), g(30_000)) }));
    expect(a).toBeGreaterThan(o + 9_000); // the cheaper child is not paid for under a hint
    expect(no).toBeGreaterThan(o + 9_000);
    expect(k).toBeGreaterThan(o + 9_000);
    expect(Math.abs(a - k)).toBeLessThan(RULESET_GAS_MODEL.node * 2);
  });
  it("else mode pays the earlier trees exactly; independent does not", () => {
    const rules = [{ when: rs.and(g(20_000), g(20_000)) }, { when: g(20_000) }, { when: rs.always(true) }];
    const ind = estimateRuleGas(rs.ruleSet("independent", ...rules), 300);
    const els = estimateRuleGas(rs.ruleSet("else", ...rules), 300);
    expect(ind[2]!.condition).toBeLessThan(5_000 + 9_000 + 900);
    expect(els[2]!.condition).toBeGreaterThan(ind[2]!.condition + 3 * 20_000);
    expect(els[0]!.condition).toBe(ind[0]!.condition);
  });
  it("state gas: one slot for the epoch plus one per distinct checkpoint slot of the rule's tree", () => {
    const gt = rs.getter(A1, SEL);
    const spec = rs.ruleSet("independent", { when: rs.and(rs.crossing(gt, 1n, "up", { initial: 0n, slot: 4 }), rs.delta(gt, 5, "up", { initial: 1n, slot: 4 }), rs.crossing(gt, 2n, "up", { initial: 0n, slot: 5 })) }, { when: rs.always(true) });
    const e = estimateRuleGas(spec, 100);
    expect(e[0]!.freshSlots).toBe(3);
    expect(e[1]!.freshSlots).toBe(1);
  });
});

describe("rule contract caps from a plan", () => {
  const specs: rs.RuleSetSpec[] = [...VALID.map((v) => v.spec), rs.ruleSet("independent", { when: rs.always(true) })];
  it("satisfy the factory's bounds (checkRuleContractArgsLocal), with and without the stake trigger", () => {
    for (const spec of specs) {
      for (const stake of [false, true]) {
        const plan = planRuleSet(spec, { stake });
        const args = defaultRuleContractArgs({ logic: A1, baseFee: 7n, suggestedTip: 1_000_000_000n, caps: plan.caps, core: DEFAULT_CORE });
        expect(checkRuleContractArgsLocal(args, DEFAULT_CORE)).toBeNull();
        expect(plan.caps.conditionGas).toBeGreaterThanOrEqual(Math.max(...plan.gas.map((x) => x.condition)));
        expect(plan.caps.maxStateGasPerFrame).toBeGreaterThanOrEqual(BigInt(Math.max(...plan.gas.map((x) => x.freshSlots))) * 97_920n);
        if (stake) expect(plan.caps.maxStateGasPerFrame).toBeGreaterThanOrEqual(293_760n);
        expect(plan.caps.maxTriggerDataLength).toBeGreaterThanOrEqual(32);
      }
    }
  });
  it("witness cap covers the OR hints and predicate witnesses; warnings name caps below the worst case", () => {
    const spec = rs.ruleSet("independent", { when: rs.and(rs.or(rs.always(), rs.always()), rs.predicate(A1, { maxWitnessBytes: 100 })) });
    expect(planRuleSet(spec).caps.maxVerifyDataLength).toBe(5 + 4 + 100);
    const w = planRuleSet(rs.ruleSet("independent", { when: rs.compare(rs.getter(A1, SEL, { gas: 40_000 }), "gt", 1n) }), { caps: { conditionGas: 10_000 } });
    expect(w.warnings.join()).toMatch(/below the worst-case estimate/);
  });
  it("an invalid spec cannot be planned", () => {
    expect(() => planRuleSet(rs.ruleSet("independent", { when: rs.kOfN(3, rs.always(), rs.always()) }))).toThrow(RuleSetInvalid);
  });
});

describe("mempool class", () => {
  const T = rs.always(true);
  it("per leaf (measured table:) and strictest-leaf for trees", () => {
    expect(leafClass(T)).toMatchObject({ publicMempool: true, unstaked: true, staked: true });
    expect(leafClass(rs.compare(rs.storage(`0x${"00".repeat(32)}`), "gt", 1n))).toMatchObject({ publicMempool: true, unstaked: true });
    expect(leafClass(rs.compare(rs.getter(A1, SEL), "gt", 1n))).toMatchObject({ publicMempool: false, unstaked: false, staked: true });
    expect(leafClass(rs.compare(rs.ethBalance("self"), "gt", 1n))).toMatchObject({ publicMempool: false, unstaked: false, staked: true });
    expect(leafClass(rs.compare(rs.erc20(A1, "self"), "gt", 1n))).toMatchObject({ publicMempool: false, unstaked: true, staked: true });
    expect(leafClass(rs.compare(rs.erc20(A1, A2), "gt", 1n))).toMatchObject({ publicMempool: false, unstaked: false, staked: true });
    expect(leafClass(rs.codeChanged(A1, `0x${"00".repeat(32)}`))).toMatchObject({ publicMempool: true, unstaked: true });
    const tree = rs.and(T, rs.or(rs.compare(rs.erc20(A1, "self"), "gt", 1n), rs.not(T)));
    expect(treeClass(tree)).toMatchObject({ publicMempool: false, unstaked: true });
    expect(treeClass(rs.and(tree, rs.compare(rs.getter(A1, SEL), "gt", 1n)))).toMatchObject({ publicMempool: false, unstaked: false });
  });
  it("else rules inherit the earlier trees' class (they are evaluated too)", () => {
    const spec = rs.ruleSet("else", { when: rs.compare(rs.getter(A1, SEL), "gt", 1n) }, { when: T });
    expect(ruleClasses(spec).map((c) => c.unstaked)).toEqual([false, false]);
    const ind = rs.ruleSet("independent", { when: rs.compare(rs.getter(A1, SEL), "gt", 1n) }, { when: T });
    expect(ruleClasses(ind).map((c) => c.unstaked)).toEqual([false, true]);
  });
});

describe("devnet budgets (DevnetConfig.budgets)", () => {
  it("record what each endpoint enforces; unknown is null, never a guess", async () => {
    const { devnets, publicPrefixBudget, getDevnet } = await import("../src/index.ts");
    expect(devnets.local.budgets).toMatchObject({ ethrex: 250_000, sidecar: { unstaked: 250_000, staked: 2_500_000 }, gateway: { unstaked: 250_000, staked: 2_500_000 } });
    expect(devnets.devnet1.budgets.ethrex).toBe(100_000);
    expect(devnets.devnet1.budgets.gateway).toEqual({ unstaked: null, staked: null });
    expect(publicPrefixBudget("local")).toBe(250_000);
    expect(publicPrefixBudget("devnet1")).toBe(100_000);
    expect(publicPrefixBudget({ ...getDevnet("local"), budgets: undefined as never })).toBe(100_000); // hand-written config without budgets
  });
  it("planRuleSet warns against the devnet's budgets and skips unknown ones", () => {
    const spec = rs.ruleSet("independent", { when: rs.compare(rs.getter(A1, SEL, { gas: 90_000 }), "gt", 1n) });
    const caps = { conditionGas: 120_000 };
    expect(planRuleSet(spec, { devnet: "devnet1", caps }).warnings.join()).toMatch(/over the public 100000 budget/);
    expect(planRuleSet(spec, { devnet: "local", caps }).warnings.join()).not.toMatch(/budget/); // 250k locally
    expect(planRuleSet(spec, { devnet: "local", caps: { conditionGas: 240_000 } }).warnings.join()).toMatch(/over the 250000 unstaked budget/);
    expect(planRuleSet(spec, { budgets: { public: null, unstaked: null }, caps: { conditionGas: 240_000 } }).warnings.join()).not.toMatch(/budget/);
  });
});

describe("shared infrastructure addresses", () => {
  it("are deterministic and depend on the stake amount only for the logic", () => {
    const a = predictRuleSetInfrastructure(0n);
    const b = predictRuleSetInfrastructure(11_000_000_000_000_000n);
    expect(a.publisher).toBe(b.publisher);
    expect(a.logic).not.toBe(b.logic);
    expect(predictRuleSetInfrastructure(0n)).toEqual(a);
  });
});

it("encodeRuleSetUnchecked builds what the validators must refuse", () => {
  const bad = encodeRuleSetUnchecked(rs.ruleSet("independent", { when: rs.kOfN(3, rs.always(), rs.always()) }));
  expect(validateConfig(bad).length).toBeGreaterThan(0);
});

describe("edge cases: action gas, retries and caps", () => {
  const T = rs.always(true);
  it("M2: the caller's caps survive (fee caps, per-config verifier); the shared path refuses a caller verifier", () => {
    const plan = planRuleSet(rs.ruleSet("independent", { when: T }));
    const user = { maxFeePerGas: 123n, maxPriorityFeePerGas: 7n, conditionGas: 20_000 };
    const shared = ruleContractCapsFor(plan, user, { shared: true, pointer: A2 });
    expect(shared).toMatchObject({ maxFeePerGas: 123n, maxPriorityFeePerGas: 7n, verifier: A2 });
    expect(shared.conditionGas).toBe(plan.caps.conditionGas);
    const per = ruleContractCapsFor(plan, { ...user, verifier: A1 }, { shared: false });
    expect(per).toMatchObject({ maxFeePerGas: 123n, maxPriorityFeePerGas: 7n, verifier: A1 });
    expect(() => ruleContractCapsFor(plan, { verifier: A1 }, { shared: true, pointer: A2 })).toThrow(/config pointer/);
    expect(ruleContractCapsFor(plan, undefined, { shared: false })).toEqual(plan.caps);
  });

  it("M1: action gas is bounded by the per-frame gas bound; retry defaults on for CALL and round-trips", () => {
    const big = rs.ruleSet("independent", { when: T, action: rs.callAction(A1, { gas: 16_777_217 }) });
    expect(validateRuleSet(big)[0]).toMatch(/action gas 16777217 outside 1\.\.16777216/);
    const mk = (retryOnFailure?: boolean) => rs.ruleSet("independent", { when: T, action: rs.callAction(A1, { gas: 50_000 }), ...(retryOnFailure !== undefined ? { retryOnFailure } : {}) }, { when: T });
    expect(decodeRuleSet(encodeRuleSet(mk())).rules.map((r) => r.retryOnFailure)).toEqual([true, false]);
    expect(decodeRuleSet(encodeRuleSet(mk(false))).rules.map((r) => r.retryOnFailure)).toEqual([false, false]);
    expect(planRuleSet(rs.ruleSet("independent", { when: T, action: rs.callAction(A1, { gas: 400_000 }) }), { caps: { maxGasPerFrame: 300_000n } }).warnings.join()).toMatch(/action gas 400000 is above maxGasPerFrame 300000 minus the 30000 reserve/);
  });

  it("L1: initial is required by the builder (type level) and checked by the validator", () => {
    // @ts-expect-error initial is required
    rs.crossing(rs.getter(A1, SEL), 1n, "up", {});
    // @ts-expect-error initial is required
    rs.delta(rs.getter(A1, SEL), 5, "up", { slot: 1 });
    expect(rs.crossing(rs.getter(A1, SEL), 1n, "up", { initial: 5n })).toMatchObject({ initial: 5n });
  });

  it("L2: maxFires 0 with CALL value or without a stateful leaf warns about draining", () => {
    const v = planRuleSet(rs.ruleSet("independent", { when: rs.crossing(rs.getter(A1, SEL), 1n, "either", { initial: 0n }), maxFires: 0, action: rs.callAction(A2, { value: 1n }) }));
    expect(v.warnings.join()).toMatch(/maxFires 0 with a CALL that sends value/);
    expect(v.warnings.join()).not.toMatch(/no crossing\/delta leaf/);
    const l = planRuleSet(rs.ruleSet("independent", { when: rs.compare(rs.getter(A1, SEL), "gt", 1n), maxFires: 0 }));
    expect(l.warnings.join()).toMatch(/no crossing\/delta leaf/);
    expect(planRuleSet(rs.ruleSet("independent", { when: T })).warnings).toEqual([]);
  });

  it("L4: a predicate without maxWitnessBytes warns loudly unless the witness cap is given", () => {
    const bare = { type: "predicate", target: A1 } as rs.Node; // as decodeRuleSet returns it
    const spec = rs.ruleSet("independent", { when: bare });
    expect(planRuleSet(spec).warnings.join()).toMatch(/predicate without maxWitnessBytes/);
    expect(planRuleSet(spec, { maxWitnessBytes: 100 }).warnings.join()).not.toMatch(/maxWitnessBytes/);
    expect(planRuleSet(rs.ruleSet("independent", { when: rs.predicate(A1, { maxWitnessBytes: 100 }) })).warnings.join()).not.toMatch(/maxWitnessBytes/);
  });

  it("L5: callee state slots are added to the state gas the plan sizes", () => {
    const base = planRuleSet(rs.ruleSet("independent", { when: T, action: rs.callAction(A1, {}) }));
    const more = planRuleSet(rs.ruleSet("independent", { when: T, action: rs.callAction(A1, { stateSlots: 3 }) }));
    expect(more.gas[0]!.freshSlots).toBe(base.gas[0]!.freshSlots + 3);
    expect(more.caps.maxStateGasPerFrame).toBeGreaterThanOrEqual(4n * 97_920n);
  });
});
