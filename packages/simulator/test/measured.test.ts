// Test gate 9: one fixture rule contract per failure, recorded on the LOCAL devnet (test/measured.ts, from
// packages/sdk/scripts/measure-9b.ts). Every expectation is on the real ethrex / sidecar strings.
import { describe, expect, it } from "vitest";
import { explain, formatReport, matchMessage, RULES } from "../src/index.ts";
import type { SimulateResultLike } from "../src/index.ts";
import * as m from "./measured.ts";

const text = (r: SimulateResultLike, network: "devnet1" | "local" = "local") => formatReport(explain(r, { network }));
const RAW_WORD = /0x0{40,}[0-9a-f]{2}\b/;

describe("measured: the recorded raw strings", () => {
  it("unstaked read of another contract", () => {
    const r = m.measuredReadOther();
    expect(r.ethrex.canonicalMempoolViolation).toBe("StorageReadNonSender");
    expect(r.sidecar!.message).toMatch(/^unstaked payer accessed 0x[0-9a-f]{40} slot 0x0{64}$/);
    expect(matchMessage(r.sidecar!.message)!.id).toBe("SIDECAR_UNSTAKED_ACCESS");
  });
  it("SSTORE in VERIFY is Core 0x20 with no other text", () => {
    const r = m.measuredWritesStorage();
    expect(BigInt(r.ethrex.revertData!)).toBe(0x20n);
    expect(r.ethrex.canonicalMempoolViolation).toBe("validation prefix frame reverted");
    expect(r.ethrex.error).toMatch(/VERIFY frame 0 \(target 0x[0-9a-f]{40}, \d+ bytes of code\) failed: RevertOpcode$/);
    expect(r.sidecar!.message).toBe("validation frame 0: reverted with data 0x0000000000000000000000000000000000000000000000000000000000000020");
  });
  it("insufficient funds: ethrex gives no reason, the sidecar names the payer", () => {
    const r = m.measuredPoor();
    expect(r.ethrex.revertData).toBeNull();
    expect(r.ethrex.canonicalMempoolViolation).toBe("validation prefix frame reverted");
    expect(r.ethrex.error).toMatch(/failed: RevertOpcode$/);
    expect(r.sidecar!.message).toMatch(/^validation frame 0: the payer 0x[0-9a-f]{40} has 1000 wei, the transaction's maximum cost is \d+ wei$/);
    expect(matchMessage(r.sidecar!.message)!.id).toBe("SIDECAR_PAYER_BALANCE");
    expect(matchMessage(r.ethrex.error!)!.id).toBe("ETHREX_VERIFY_REVERT_OPAQUE");
    expect(matchMessage(r.ethrex.canonicalMempoolViolation!)!.id).toBe("SIDECAR_PREFIX_REVERTED");
  });
});

describe("test gate 9", () => {
  it("unstaked rule contract reading another contract: stake the rule contract", () => {
    const r = explain(m.measuredReadOther(), { network: "local" });
    expect(r.publicMempool.headline).toBe("reads another contract's storage");
    expect(r.altMempool.headline).toBe("that read needs a stake; this rule contract has none");
    expect(formatReport(r)).toContain("Stake the rule contract");
    expect(r.summary).toBe("rejected by both mempools");
  });

  it("heavy VERIFY on devnet1: validation used N gas, over the 100k budget; alt mempool admits", () => {
    const f = m.measuredHeavy();
    const r = explain(f, { network: "devnet1" });
    expect(r.publicMempool.ok).toBe(false);
    expect(r.publicMempool.headline).toMatch(/^validation used \d{3},\d{3} gas, over the 100,000 budget$/);
    expect(r.altMempool.ok).toBe(true);
    expect(r.altMempool.headline).toContain("admitted by ERC-8421");
    expect(r.summary).toBe("alt mempool only");
    // same recording on the local devnet's 250k public budget
    const l = explain(f, { network: "local" });
    expect(l.publicMempool.ok).toBe(true);
    expect(l.summary).toBe("accepted by both mempools");
  });

  it("condition writes storage: writes storage during validation", () => {
    const t = text(m.measuredWritesStorage());
    expect(t).toContain("writes storage during validation");
    expect(t).toContain("move the write into __action");
  });

  it("rule contract with too little balance: balance can't cover the worst-case trigger", () => {
    const r = explain(m.measuredPoor(), { network: "local" });
    expect(r.publicMempool.headline).toBe("the rule contract balance can't cover the worst-case trigger");
    expect(r.altMempool.headline).toBe("the rule contract balance can't cover the worst-case trigger");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.evidence).toContain("rule contract balance 1000 wei <");
  });

  it("valid rule contract: admitted by ERC-8421 and a clear public verdict", () => {
    const r = explain(m.measuredValid(), { network: "local" });
    expect(r.altMempool.headline).toContain("admitted by ERC-8421");
    expect(r.publicMempool.headline).toMatch(/^ethrex accepts it: canonical, within the 250,000 gas budget \(VERIFY used 28,136 gas\)$/);
    expect(r.summary).toBe("accepted by both mempools");
    expect(r.warnings).toHaveLength(0);
  });

  it("staked rule contract reading another contract: alt admits, public refuses, and says why", () => {
    const r = explain(m.measuredStakedRead(), { network: "local" });
    expect(r.altMempool.ok).toBe(true);
    expect(r.publicMempool.headline).toBe("reads another contract's storage");
    expect(r.warnings.map((w) => w.rule)).toContain("SDK_STAKED_READ_PUBLIC_ONLY");
  });

  it("no raw 32-byte Core words or 'UNKNOWN' in any recorded report", () => {
    for (const k of Object.keys(m) as (keyof typeof m)[]) {
      for (const net of ["local", "devnet1"] as const) {
        const t = text(m[k](), net);
        expect(t, `${k}/${net}`).not.toMatch(RAW_WORD);
        expect(t, `${k}/${net}`).not.toContain("UNKNOWN");
      }
    }
  });
});

describe("stake status and payer inputs", () => {
  it("sidecar not asked: an unstaked read is predicted NO, a staked one is not blocked", () => {
    const a = m.measuredReadOther();
    a.sidecar = null;
    const ra = explain(a, { network: "local" });
    expect(ra.altMempool.ok).toBe(false);
    expect(ra.altMempool.headline).toContain("that read needs a stake");
    expect(ra.altMempool.headline).toMatch(/^predicted: /);
    const b = m.measuredStakedRead();
    b.sidecar = null;
    const rb = explain(b, { network: "local" });
    expect(rb.altMempool).toMatchObject({ ok: true, predicted: true });
    expect(rb.altMempool.headline).toBe("predicted: within 2,500,000 (staked) and outside reads allowed by the rule contract's stake");
    const c = m.measuredReadOther(); // stake status unknown + an outside read: cannot tell
    c.sidecar = null;
    c.stake = null;
    expect(explain(c, { network: "local" }).altMempool.ok).toBeNull();
  });

  it("sidecar not asked: the alt budget is 250k unstaked, 2.5M staked", () => {
    const a = m.measuredValid();
    a.sidecar = null;
    a.verifyGasLimit = 400_000n;
    expect(explain(a, { network: "local" }).altMempool.ok).toBe(false);
    a.stake = { registry: "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f", stake: 1n, isStaked: true };
    expect(explain(a, { network: "local" }).altMempool).toMatchObject({ ok: true, predicted: true });
    a.verifyGasLimit = 3_000_000n;
    expect(explain(a, { network: "local" }).altMempool.rules).toEqual(["SIDECAR_BUDGET_010"]);
  });

  it("default (sidecar not asked) on every recording: predicted verdicts agree with the sidecar's real ones", () => {
    for (const k of ["measuredReadOther", "measuredHeavy", "measuredWritesStorage", "measuredPoor", "measuredValid", "measuredStakedRead"] as const) {
      const asked = m[k]();
      const guess = m[k]();
      guess.sidecar = null;
      const a = explain(asked, { network: "local" }).altMempool.ok;
      const g = explain(guess, { network: "local" }).altMempool;
      expect(g.ok, k).toBe(a);
      expect(g.predicted, k).toBe(true);
    }
  });

  it("network comes from the result when the option is absent", () => {
    const a = m.measuredHeavy();
    expect(explain(a).publicMempool.ok).toBe(true); // network: "local"
    a.network = "devnet1";
    expect(explain(a).publicMempool.ok).toBe(false);
  });

  it("caller-pays: the payer's balance is checked, not the rule contract's", () => {
    const a = m.measuredValid();
    a.payer = "0x1111111111111111111111111111111111111111";
    a.ruleContractBalance = 0n;
    a.payerBalance = 10n;
    a.sidecar = null;
    const r = explain(a, { network: "local" });
    expect(r.publicMempool.headline).toBe("the payer's balance can't cover the worst-case trigger");
    a.payerBalance = a.maxCost;
    a.minOperatingBalance = BigInt(a.maxCost) * 10n;
    const ok = explain(a, { network: "local" });
    expect(ok.publicMempool.ok).toBe(true);
    expect(ok.warnings.map((w) => w.rule)).not.toContain("SDK_BALANCE_BELOW_MIN_OPERATING");
  });

  it("rules: every rule has an id, a sentence and a fix", () => {
    expect(RULES.length).toBe(133);
    for (const r of RULES) expect(r.sentence.length > 0 && r.fix.length > 0).toBe(true);
  });
});
