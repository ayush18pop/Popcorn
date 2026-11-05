import { describe, expect, it } from "vitest";
import { explain, formatReport, RULES, toJSON } from "../src/index.ts";
import * as fx from "./fixtures.ts";
import { word } from "./fixtures.ts";
import type { SimulateResultLike } from "../src/types.ts";

describe("fixtures from recorded failures", () => {
  it("unstaked shield: reads another contract's storage; stake the rule contract", () => {
    const r = explain(fx.unstakedShield());
    expect(r.publicMempool.ok).toBe(false);
    expect(r.publicMempool.headline).toContain("reads another contract's storage");
    expect(r.altMempool.ok).toBe(false);
    expect(r.altMempool.headline).toContain("needs a stake");
    const text = formatReport(r);
    expect(text).toMatch(/^public mempool {2}NO/m);
    expect(text).toMatch(/^alt mempool {5}NO/m);
    expect(text).toContain("fix  Stake the rule contract");
    expect(r.findings.map((f) => f.rule)).toEqual(expect.arrayContaining(["ETHREX_STORAGE_READ_NON_SENDER", "SIDECAR_UNSTAKED_ACCESS"]));
    expect(r.findings.find((f) => f.rule === "SIDECAR_UNSTAKED_ACCESS")!.evidence).toContain("0xbb437398");
  });

  it("exploit rule contract over 100k on devnet1: public NO (budget), alt YES", () => {
    const r = explain(fx.exploitOver100k(), { network: "devnet1" });
    expect(r.publicMempool.ok).toBe(false);
    expect(r.publicMempool.rules).toContain("ETHREX_PREFIX_BUDGET");
    expect(r.altMempool.ok).toBe(true);
    expect(r.summary).toBe("alt mempool only");
    expect(r.warnings.map((w) => w.rule)).toContain("SDK_ALT_ONLY");
    expect(formatReport(r)).toContain("alt mempool     YES");
  });

  it("the same 149k trigger on the local devnet (250k public budget) is fine for the budget", () => {
    const f = fx.exploitOver100k();
    f.ethrex.canonicalMempoolValid = true;
    f.ethrex.canonicalMempoolViolation = null;
    const r = explain(f, { network: "local" });
    expect(r.publicMempool.ok).toBe(true);
    expect(r.summary).toBe("accepted by both mempools");
  });

  it("budget is computed from the declared limit even when ethrex simulate says canonical", () => {
    const f = fx.validRuleContract();
    f.verifyGasLimit = 120_000n;
    expect(explain(f).publicMempool.rules).toEqual(["ETHREX_PREFIX_BUDGET"]);
    expect(explain(f, { network: "local" }).publicMempool.ok).toBe(true);
  });

  it("260k unstaked: both refuse, BUDGET-010 on the alt side", () => {
    const r = explain(fx.exploitOver250k());
    expect(r.publicMempool.ok).toBe(false);
    expect(r.altMempool.ok).toBe(false);
    expect(r.altMempool.rules).toContain("SIDECAR_BUDGET_010");
    expect(r.summary).toBe("rejected by both mempools");
  });

  it("condition writes storage: 'writes storage during validation'", () => {
    const r = explain(fx.writesStorage());
    expect(r.publicMempool.headline).toContain("writes storage during validation");
    expect(r.altMempool.headline).toContain("writes storage during validation");
    expect(r.publicMempool.rules).toEqual(["CORE_0x20"]);
    expect(formatReport(r)).toContain("move the write into __action");
  });

  it("an SSTORE named in the ethrex violation text is detected", () => {
    const f = fx.validRuleContract();
    f.ethrex.canonicalMempoolValid = false;
    f.ethrex.canonicalMempoolViolation = "Sstore in VERIFY (SSTORE)";
    expect(explain(f).publicMempool.rules).toEqual(["ETHREX_WRITE_DURING_VERIFY"]);
  });

  it("rule contract balance too low: 'balance can't cover the worst-case trigger'", () => {
    const r = explain(fx.poorRuleContract());
    expect(r.publicMempool.ok).toBe(false);
    expect(r.altMempool.headline).toContain("balance can't cover the worst-case trigger");
    expect(r.findings.some((f) => f.rule === "SDK_BALANCE_BELOW_MAX_COST")).toBe(true);
    expect(r.findings).toHaveLength(1); // the opaque revert and the node message fold into the one cause
    expect(r.findings[0]!.evidence).toContain("100000000000000 wei");
  });

  it("balance under maxCost is caught even when both nodes say valid", () => {
    const f = fx.validRuleContract();
    f.ruleContractBalance = 1n;
    const r = explain(f);
    expect(r.publicMempool.ok).toBe(false);
    expect(r.publicMempool.headline).toContain("can't cover the worst-case trigger");
  });

  it("balance between maxCost and minOperatingBalance is a warning only", () => {
    const f = fx.validRuleContract();
    f.ruleContractBalance = 528_348_000_000_001n;
    const r = explain(f);
    expect(r.publicMempool.ok).toBe(true);
    expect(r.warnings.map((w) => w.rule)).toContain("SDK_BALANCE_BELOW_MIN_OPERATING");
  });

  it("valid rule contract: admitted by ERC-8421 and a clear public verdict", () => {
    const r = explain(fx.validRuleContract());
    expect(r.altMempool.headline).toContain("admitted by ERC-8421");
    expect(r.publicMempool.ok).toBe(true);
    expect(r.publicMempool.headline).toContain("100,000 gas budget");
    expect(r.publicMempool.headline).toContain("27,990");
    expect(r.findings).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(formatReport(r)).toMatch(/^public mempool {2}YES/);
  });

  it("valid but the action reverts: warning, not a block", () => {
    const f = fx.validRuleContract();
    f.ethrex.executionStatus = "reverted";
    const r = explain(f);
    expect(r.publicMempool.ok).toBe(true);
    expect(r.warnings.map((w) => w.rule)).toContain("SDK_ACTION_REVERTS");
  });

  it("condition false (0x22) from ethrex and the sidecar message", () => {
    const r = explain(fx.conditionFalse());
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.rule).toBe("CORE_0x22");
    expect(r.findings[0]!.mempool).toBe("both");
    expect(r.publicMempool.headline).toBe("the condition is false");
  });

  it("replay: nonce mismatch", () => {
    const r = explain(fx.replay());
    expect(r.findings[0]!.rule).toBe("ETHREX_NONCE_MISMATCH");
    expect(r.findings).toHaveLength(1);
  });

  it("no sidecar verdict: alt is unknown, or predicted NO from ethrex's Core code", () => {
    const f = fx.validRuleContract();
    f.sidecar = null;
    const v = explain(f);
    expect(v.altMempool).toMatchObject({ ok: true, predicted: true });
    expect(v.altMempool.headline).toBe("predicted: within 250,000 (unstaked assumed) and no outside reads");
    expect(v.summary).toBe("accepted by both mempools (alt mempool predicted)");
    expect(formatReport(v)).toContain("alt mempool     YES  predicted: within 250,000");
    const q = fx.validRuleContract(); // sidecar asked but unreachable: not checked, not predicted
    q.sidecar = null;
    q.sidecarError = "fetch failed";
    expect(explain(q).altMempool.ok).toBeNull();
    expect(formatReport(explain(q))).toMatch(/alt mempool {5}\?/);
    const g = fx.conditionFalse();
    g.sidecar = null;
    g.sidecarError = "fetch failed";
    const r = explain(g);
    expect(r.altMempool.ok).toBe(false);
    expect(r.warnings.map((w) => w.rule)).toContain("SDK_SIDECAR_UNREACHABLE");
  });

  it("no sidecar verdict and VERIFY over 250k: predicts the unstaked alt budget", () => {
    const f = fx.validRuleContract();
    f.sidecar = null;
    f.verifyGasLimit = 260_000n;
    const r = explain(f);
    expect(r.altMempool.rules).toEqual(["SDK_ALT_OVER_UNSTAKED_BUDGET"]);
  });
});

describe("every Core code round-trips", () => {
  const CODES = [
    ...Array.from({ length: 0x27 }, (_, i) => i + 1), // 0x01-0x27
    ...Array.from({ length: 0x3c - 0x30 + 1 }, (_, i) => 0x30 + i), // 0x30-0x3c
    ...Array.from({ length: 0x4b - 0x40 + 1 }, (_, i) => 0x40 + i), // 0x40-0x4b
    ...Array.from({ length: 0x6a - 0x50 + 1 }, (_, i) => 0x50 + i).filter((c) => c !== 0x64), // 0x50-0x6a (0x64 is unused)
  ];
  const sim = (over: Partial<SimulateResultLike>, code: number): SimulateResultLike => ({
    ...fx.validRuleContract(), ...over,
    ethrex: { ...fx.validRuleContract().ethrex, valid: false, executionStatus: null, verifyGas: null, revertData: word(code) },
  });

  it("the table covers 0x01-0x27, 0x30-0x3c, 0x40-0x4b and 0x50-0x6a", () => {
    expect(CODES).toHaveLength(0x27 + 13 + 12 + (0x6a - 0x50));
  });

  for (const code of CODES) {
    const h = `0x${code.toString(16).padStart(2, "0")}`;
    it(`Core ${h} has a sentence (ethrex revertData and sidecar message)`, () => {
      for (const r of [
        explain(sim({ sidecar: null }, code)),
        explain({ ...sim({}, code), sidecar: { admitted: false, code: -32500, message: `validation frame 0: reverted with data ${word(code)}` } }),
      ]) {
        const all = [...r.findings, ...r.warnings];
        expect(all).toHaveLength(1);
        const f = all[0]!;
        expect(f.rule).toBe(`CORE_${h}`);
        expect(f.sentence).toContain(`Core ${h}:`);
        expect(f.sentence).not.toContain(word(code));
        expect(f.fix.length).toBeGreaterThan(10);
        expect(f.rule).not.toMatch(/UNKNOWN/);
      }
    });
  }

  it("a VERIFY-time Core code blocks both mempools, with a plain verdict line", () => {
    const r = explain(sim({}, 0x12));
    expect(r.publicMempool.headline).toBe("max fee is above the rule contract's cap");
  });
});

describe("unknown inputs are never dropped", () => {
  it("unknown Core code shows the raw code", () => {
    const f = fx.validRuleContract();
    f.ethrex = { ...f.ethrex, valid: false, executionStatus: null, revertData: word(0x99) };
    f.sidecar = { admitted: false, code: -32500, message: `validation frame 0: reverted with data ${word(0x99)}` };
    const r = explain(f);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.rule).toBe("SDK_UNKNOWN_CORE_CODE");
    expect(r.findings[0]!.sentence).toContain("0x99");
    expect(r.findings[0]!.evidence).toContain("0x99");
    expect(formatReport(r)).toContain("0x99");
  });

  it("unknown ethrex and sidecar messages show the raw text", () => {
    const f = fx.validRuleContract();
    f.ethrex = { ...f.ethrex, valid: false, executionStatus: null, error: "Frobnicator exploded" };
    f.sidecar = { admitted: false, code: -32099, message: "zorp not allowed" };
    const r = explain(f);
    expect(r.findings.map((x) => x.rule).sort()).toEqual(["SDK_UNKNOWN_ETHREX", "SDK_UNKNOWN_SIDECAR"]);
    expect(r.findings.find((x) => x.rule === "SDK_UNKNOWN_ETHREX")!.evidence).toContain("Frobnicator exploded");
    expect(r.findings.find((x) => x.rule === "SDK_UNKNOWN_SIDECAR")!.evidence).toContain("zorp not allowed");
  });

  it("invalid with only unrecognised revert data keeps the data", () => {
    const f = fx.validRuleContract();
    f.ethrex = { ...f.ethrex, valid: false, executionStatus: null, revertData: "0xdeadbeef" };
    f.sidecar = null;
    expect(explain(f).findings[0]!.evidence).toContain("0xdeadbeef");
  });
});

describe("recorded rejection strings", () => {
  const ethrexOnly = (error: string | null, violation: string | null = null, valid = false): SimulateResultLike => ({
    ...fx.validRuleContract(), sidecar: null,
    ethrex: { ...fx.validRuleContract().ethrex, valid, executionStatus: valid ? "success" : null, canonicalMempoolValid: valid && !violation, canonicalMempoolViolation: violation, error },
  });
  const side = (message: string, code = -32500): SimulateResultLike => ({ ...fx.validRuleContract(), sidecar: { admitted: false, code, message } });
  const altRule = (m: string, code?: number) => explain(side(m, code)).altMempool.rules;

  it.each([
    ["Frame transaction prefix gas budget (frames + sig cost) exceeds MAX_VERIFY_GAS", "ETHREX_PREFIX_BUDGET"],
    ["validation prefix execution gas sum 100001 + signature-verification cost 0 = 100001 exceeds MAX_VERIFY_GAS 100000", "ETHREX_PREFIX_BUDGET"],
    ["frame signature list does not authenticate the sender", "ETHREX_SIGNATURE_LIST"],
    ["Frame 0: non-zero value only allowed in SENDER mode (mode=1, value=1)", "ETHREX_VERIFY_VALUE"],
    ["Invalid params: Frame transaction validation-prefix simulation failed: StorageReadNonSender", "ETHREX_STORAGE_READ_NON_SENDER"],
  ])("ethrex: %s", (msg, rule) => {
    expect(explain(ethrexOnly(msg)).publicMempool.rules).toEqual([rule]);
  });

  it.each([
    ["entity 0x995B validation gas 260000 exceeds unstaked budget 250000 (BUDGET-010)", "SIDECAR_BUDGET_010", -32602],
    ["unstaked payer accessed 0x634f slot 0x00", "SIDECAR_UNSTAKED_ACCESS", -32502],
    ["frame transaction validation prefix not recognized", "SIDECAR_PREFIX_NOT_RECOGNIZED", -32502],
    ["Invalid frame transaction signature", "SIDECAR_INVALID_SIGNATURE", -32507],
    ["nested CALL with value during validation", "SIDECAR_OP_061", -32502],
    ["factory uses banned opcode: GASPRICE", "SIDECAR_OP_011", -32502],
    ["sender uses banned opcode: CREATE2", "SIDECAR_CREATE", -32502],
    ["sender accesses un-deployed contract address 0xabc with opcode CALL", "SIDECAR_COD_010", -32502],
    ["sender has forbidden write to 0xabc slot 0x01", "SIDECAR_STO_FORBIDDEN_WRITE", -32502],
    ["validation frame 0: ran out of gas", "SIDECAR_OUT_OF_GAS", -32500],
    ["validation frame 0: reverted", "SIDECAR_VERIFY_REVERT_DATA", -32500],
    ["validation frame 0: reverted with data 0x08c379a0", "SIDECAR_VERIFY_REVERT_DATA", -32500],
    ["frame 1 is a VERIFY frame after the validation prefix (ends at index 0)", "SIDECAR_VERIFY_AFTER_PREFIX", -32602],
    ["EIP-8272 reference expired", "SIDECAR_RECENT_ROOT", -32500],
  ])("sidecar: %s", (msg, rule, code) => {
    expect(altRule(msg, code)).toEqual([rule]);
  });

  it("ethrex banned-opcode violation (describeEthrexViolation form)", () => {
    expect(explain(ethrexOnly(null, "banned opcode: GASPRICE (0x3a)", true)).publicMempool.rules).toEqual(["ETHREX_BANNED_OPCODE"]);
  });
});

describe("rule table", () => {
  it("ids are unique, titles <= 8 words, every entry complete", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    for (const r of RULES) {
      expect(r.title.split(/\s+/).length, r.id).toBeLessThanOrEqual(8);
      expect(r.sentence.length, r.id).toBeGreaterThan(20);
      expect(r.fix.length, r.id).toBeGreaterThan(10);
      expect(r.short.length, r.id).toBeGreaterThan(5);
    }
  });
  it("covers all four sources", () => {
    const by = (s: string) => RULES.filter((r) => r.source === s).length;
    expect(by("core")).toBe(0x27 + 13 + 12 + (0x6a - 0x50));
    expect(by("ethrex")).toBeGreaterThan(5);
    expect(by("sidecar")).toBeGreaterThan(10);
    expect(by("sdk")).toBeGreaterThan(5);
  });
});

describe("output", () => {
  it("toJSON round-trips", () => {
    const r = explain(fx.unstakedShield());
    expect(JSON.parse(toJSON(r))).toEqual(JSON.parse(JSON.stringify(r)));
  });
  it("accepts JSON-decoded numerics (strings/numbers)", () => {
    const f = JSON.parse(JSON.stringify(fx.validRuleContract(), (_, v) => (typeof v === "bigint" ? v.toString() : v)));
    expect(explain(f).altMempool.ok).toBe(true);
  });
  it("formatted unstaked-shield report", () => {
    expect(formatReport(explain(fx.unstakedShield()))).toMatchInlineSnapshot(`
      "public mempool  NO   reads another contract's storage
      alt mempool     NO   that read needs a stake; this rule contract has none
      fix  Stake the rule contract: deployRule({ stake: true }) or stakeRuleContract(rule contract), then simulate again.
      fix  Keep the condition on the rule contract's own storage for the public mempool, or send this trigger through an alt-mempool sidecar (stake the rule contract so it admits the read)."
    `);
  });
});
