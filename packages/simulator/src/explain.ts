// explain(): raw verdicts (ethrex + sidecar) -> a structured, plain-English Report. Pure: no network.

import { coreRule, matchMessage, ruleById } from "./rules.ts";
import type { ExplainOptions, Finding, Num, Report, Rule, SimulateResultLike, Verdict } from "./types.ts";

/** Measured budgets (contracts/core/SPEC.md section 9): public ethrex prefix, and the sidecar per entity. */
export const BUDGETS = {
  publicDevnet1: 100_000n,
  publicLocal: 250_000n,
  altUnstaked: 250_000n,
  altStaked: 2_500_000n,
} as const;

const toBig = (n: Num | null | undefined): bigint | null => {
  if (n === null || n === undefined) return null;
  try {
    return typeof n === "bigint" ? n : BigInt(n);
  } catch {
    return null;
  }
};

const hex2 = (n: number) => `0x${n.toString(16).padStart(2, "0")}`;
const fmt = (n: bigint) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Core code from a 32-byte revert word (`0x…22`), else null. */
function coreCodeOfWord(word: string | null | undefined): number | null {
  if (!word || !/^0x[0-9a-fA-F]{64}$/.test(word)) return null;
  const v = BigInt(word);
  return v <= 0xffffn ? Number(v) : null;
}

/** Core code from a sidecar message `validation frame 0: reverted with data 0x…`. */
function coreCodeOfMessage(msg: string): number | null {
  const m = msg.match(/reverted with data (0x[0-9a-fA-F]{64})\b/);
  return m ? coreCodeOfWord(m[1]!) : null;
}

const OPAQUE = new Set(["ETHREX_VERIFY_REVERT_OPAQUE", "SIDECAR_PREFIX_REVERTED", "SIDECAR_VERIFY_REVERT_DATA"]);

type Side = "public" | "alt";

function finding(rule: Rule, mempool: Finding["mempool"], evidence: string): Finding {
  return {
    rule: rule.id, source: rule.source, title: rule.title, short: rule.short, sentence: rule.sentence,
    fix: rule.fix, severity: rule.severity, mempool, evidence,
  };
}

/** Match a Core code, else a message, else an unknown-* generic finding that still shows the raw text. */
function classify(side: Side, code: number | null, texts: string[]): Finding {
  const raw = texts.filter(Boolean).join(" | ");
  if (code !== null) {
    const r = coreRule(code);
    if (r) return finding(r, side, raw || hex2(code));
    const u = finding(ruleById("SDK_UNKNOWN_CORE_CODE"), side, `Core code ${hex2(code)}${raw ? ` (${raw})` : ""}`);
    return { ...u, short: `Core reverted with unknown code ${hex2(code)}`, sentence: `Core reverted with code ${hex2(code)}, which this simulator does not know.` };
  }
  for (const t of texts) {
    const r = t ? matchMessage(t) : null;
    if (r) return finding(r, side, raw);
  }
  const unknown = ruleById(side === "public" ? "SDK_UNKNOWN_ETHREX" : "SDK_UNKNOWN_SIDECAR");
  const f = finding(unknown, side, raw || "(no message)");
  const clip = raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
  return clip ? { ...f, short: `${side === "public" ? "ethrex" : "the sidecar"} said: ${clip}` } : f;
}

function mergeInto(list: Finding[], f: Finding): void {
  const i = list.findIndex((x) => x.rule === f.rule);
  if (i < 0) return void list.push(f);
  const prev = list[i]!;
  list[i] = {
    ...prev,
    mempool: prev.mempool === f.mempool ? prev.mempool : "both",
    evidence: prev.evidence === f.evidence || prev.evidence.includes(f.evidence) ? prev.evidence : `${prev.evidence} | ${f.evidence}`,
  };
}

export function explain(result: SimulateResultLike, opts: ExplainOptions = {}): Report {
  const network = opts.network ?? result.network ?? "devnet1";
  const publicBudget = network === "local" ? BUDGETS.publicLocal : BUDGETS.publicDevnet1;
  const e = result.ethrex;
  const sc = result.sidecar;

  const all: Finding[] = [];
  const publicBlocks: Finding[] = [];
  const altBlocks: Finding[] = [];
  const warn: Finding[] = [];
  const add = (f: Finding) => {
    if (f.severity === "warns") mergeInto(warn, f);
    else {
      mergeInto(all, f);
      if (f.mempool !== "alt") mergeInto(publicBlocks, f);
      if (f.mempool !== "public") mergeInto(altBlocks, f);
    }
  };

  const declared = toBig(result.verifyGasLimit) ?? toBig(e.verifyGas);
  const used = toBig(e.verifyGas);
  const callerPays = !!result.payer;
  // Who reserves the fee: the rule contract (rule-pays) or the payer (caller-pays).
  const balance = callerPays ? toBig(result.payerBalance) : toBig(result.ruleContractBalance);
  const stakeKnown = result.stake !== undefined && result.stake !== null;
  const staked = stakeKnown && result.stake!.isStaked;
  const altBudget = staked ? BUDGETS.altStaked : BUDGETS.altUnstaked;
  const maxCost = toBig(result.maxCost) ?? toBig(e.maxCost);
  const minOp = toBig(result.minOperatingBalance);

  // ---- ethrex (the public canonical mempool)
  let ethrexFinding: Finding | null = null;
  if (!e.valid) {
    const code = coreCodeOfWord(e.revertData);
    const texts = [e.error ?? "", e.canonicalMempoolViolation ?? ""];
    ethrexFinding = classify("public", code, texts);
    if (code === null && e.revertData && e.revertData !== "0x" && !texts.some(Boolean)) {
      ethrexFinding = { ...ethrexFinding, evidence: `revertData ${e.revertData}` };
    }
  } else if (!e.canonicalMempoolValid) {
    ethrexFinding = classify("public", null, [e.canonicalMempoolViolation ?? ""]);
    if (!e.canonicalMempoolViolation) {
      ethrexFinding = { ...ethrexFinding, evidence: "canonicalMempoolValid=false (no violation text)" };
    }
  }
  // "validation used N gas, over the 100,000 budget": ethrex's own "exceeded: N > M" text, or the computed numbers.
  const budgetShort = (n: bigint, b: bigint) => `validation used ${fmt(n)} gas, over the ${fmt(b)} budget`;
  if (ethrexFinding?.rule === "ETHREX_PREFIX_BUDGET") {
    const m = ethrexFinding.evidence.match(/exceeded: (\d+) > (\d+)/);
    if (m) ethrexFinding = { ...ethrexFinding, short: budgetShort(BigInt(m[1]!), BigInt(m[2]!)) };
  }
  if (ethrexFinding) {
    // ethrex messages apply to the public mempool; Core/balance/structure rules also hold for the alt mempool.
    const r = ruleById(ethrexFinding.rule);
    const scope: Finding["mempool"] = r.mempool === "public" ? "public" : r.mempool === "alt" ? "alt" : sc ? "public" : "both";
    add({ ...ethrexFinding, mempool: scope });
  }

  // ---- computed: VERIFY gas against the public budget
  const budgetFinding = all.some((f) => f.rule === "ETHREX_PREFIX_BUDGET");
  if (declared !== null && declared > publicBudget && !budgetFinding) {
    const f = finding(ruleById("ETHREX_PREFIX_BUDGET"), "public", `declared VERIFY gas ${fmt(declared)} > public budget ${fmt(publicBudget)} (${network})`);
    add({ ...f, short: budgetShort(toBig(result.prefixGas) ?? declared, publicBudget) });
  }

  // ---- sidecar (the alt mempool)
  let altPredicted = false;
  if (sc && !sc.admitted) {
    const code = coreCodeOfMessage(sc.message);
    let f = classify("alt", code, [sc.message]);
    const bm = f.rule === "SIDECAR_BUDGET_010" ? sc.message.match(/validation gas (\d+) exceeds (staked|unstaked) budget (\d+)/) : null;
    if (bm) f = { ...f, short: `validation used ${fmt(BigInt(bm[1]!))} gas, over the ${bm[2]} ${fmt(BigInt(bm[3]!))} alt budget` };
    add({ ...f, evidence: `[${sc.code ?? "?"}] ${sc.message}`.replace(/^\[\?\] /, "") });
  } else if (!sc) {
    altPredicted = true;
    if (result.sidecarError) add(finding(ruleById("SDK_SIDECAR_UNREACHABLE"), "alt", result.sidecarError));
    if (declared !== null && declared > altBudget) {
      if (staked) {
        add({ ...finding(ruleById("SIDECAR_BUDGET_010"), "alt", `declared VERIFY gas ${fmt(declared)} > staked alt budget ${fmt(altBudget)}`) });
      } else {
        add(finding(ruleById("SDK_ALT_OVER_UNSTAKED_BUDGET"), "alt", `declared VERIFY gas ${fmt(declared)} > unstaked alt budget ${fmt(altBudget)}${stakeKnown ? " (no stake)" : ""}`));
      }
    }
    // Sidecar not asked: ethrex saw a read of another contract. Only a staked rule contract may do that in the alt mempool.
    if (stakeKnown && !staked && ethrexFinding?.rule === "ETHREX_STORAGE_READ_NON_SENDER") {
      add(finding(ruleById("SIDECAR_UNSTAKED_ACCESS"), "alt", `ethrex: ${e.canonicalMempoolViolation}; the registry shows no stake for this rule contract`));
    }
  }

  // ---- computed: balance (after the sidecar, so a node-reported balance message is not duplicated)
  const lowBalance = balance !== null && maxCost !== null && balance < maxCost;
  if (lowBalance) {
    // The cause holds for both mempools; keep the nodes' own messages as evidence.
    const nodeSaid = all.filter((f) => /BALANCE|FUNDS/.test(f.rule)).map((f) => f.evidence);
    for (const list of [all, publicBlocks, altBlocks]) {
      for (let i = list.length - 1; i >= 0; i--) if (/BALANCE|FUNDS/.test(list[i]!.rule)) list.splice(i, 1);
    }
    const own = `${callerPays ? "payer" : "rule contract"} balance ${balance} wei < maxCost ${maxCost} wei`;
    add(finding(ruleById(callerPays ? "SDK_PAYER_BALANCE_BELOW_MAX_COST" : "SDK_BALANCE_BELOW_MAX_COST"), "both", [own, ...nodeSaid].join(" | ")));
    // A bare "VERIFY reverted" is just the symptom of the empty balance; keep the cause.
    for (const list of [all, publicBlocks, altBlocks]) {
      for (let i = list.length - 1; i >= 0; i--) if (OPAQUE.has(list[i]!.rule)) list.splice(i, 1);
    }
  } else if (!callerPays && balance !== null && minOp !== null && balance < minOp) {
    add(finding(ruleById("SDK_BALANCE_BELOW_MIN_OPERATING"), "both", `rule contract balance ${balance} wei < minOperatingBalance ${minOp} wei`));
  }

  // ---- computed: action reverts
  if (e.valid && e.executionStatus === "reverted") {
    add(finding(ruleById("SDK_ACTION_REVERTS"), "both", "executionStatus=reverted"));
  }

  // ---- a staked rule contract that reads other contracts is still refused by public ethrex
  if (staked && ethrexFinding?.rule === "ETHREX_STORAGE_READ_NON_SENDER") add(finding(ruleById("SDK_STAKED_READ_PUBLIC_ONLY"), "public", `registry stake ${String(result.stake!.stake)} wei`));

  // ---- the alt-only note
  const publicNo = publicBlocks.length > 0;
  const altNo = altBlocks.length > 0;
  if (publicNo && !altNo && (sc?.admitted ?? false)) add(finding(ruleById("SDK_ALT_ONLY"), "alt", "ethrex NO, sidecar admitted"));

  // ---- verdicts
  const gasNote = used !== null ? ` (VERIFY used ${fmt(used)} gas)` : "";
  const publicMempool: Verdict = publicNo
    ? { ok: false, headline: publicBlocks[0]!.short, rules: publicBlocks.map((f) => f.rule) }
    : { ok: true, headline: `ethrex accepts it: canonical, within the ${fmt(publicBudget)} gas budget${gasNote}`, rules: [] };

  let altMempool: Verdict;
  if (altNo) {
    altMempool = { ok: false, ...(altPredicted ? { predicted: true } : {}), headline: (altPredicted ? "predicted: " : "") + altBlocks[0]!.short, rules: altBlocks.map((f) => f.rule) };
  } else if (sc?.admitted) {
    altMempool = { ok: true, headline: "admitted by ERC-8421 (the sidecar's rules all pass)", rules: [] };
  } else if (altPredicted && e.valid && !result.sidecarError && !warn.some((f) => f.rule === "SDK_SIDECAR_UNREACHABLE")) {
    // The sidecar was not asked (it would have to receive, and maybe include, the trigger): derive the verdict.
    const v = e.canonicalMempoolViolation ?? "";
    const outsideRead = /StorageReadNonSender/.test(v);
    const otherViolation = !e.canonicalMempoolValid && v !== "" && !outsideRead && !/prefix gas budget|MAX_VERIFY_GAS/.test(v);
    const budgetTxt = `${fmt(altBudget)} (${staked ? "staked" : stakeKnown ? "unstaked" : "unstaked assumed"})`;
    if (otherViolation || (outsideRead && !stakeKnown)) {
      altMempool = { ok: null, predicted: true, headline: `not checked: ethrex flagged "${v}" and the stake status ${stakeKnown ? "does not settle it" : "is unknown"}`, rules: [] };
    } else {
      const reads = outsideRead ? "outside reads allowed by the rule contract's stake" : "no outside reads";
      altMempool = { ok: true, predicted: true, headline: `predicted: within ${budgetTxt} and ${reads}`, rules: [] };
    }
  } else {
    altMempool = { ok: null, headline: "not checked: no sidecar verdict, and nothing in the ethrex result rules it out", rules: [] };
  }

  const pub = publicMempool.ok;
  const alt = altMempool.ok;
  const summary =
    pub && alt ? (altMempool.predicted ? "accepted by both mempools (alt mempool predicted)" : "accepted by both mempools")
    : pub && alt === null ? "accepted by the public mempool; alt mempool not checked"
    : !pub && alt ? (altMempool.predicted ? "alt mempool only (predicted)" : "alt mempool only")
    : !pub && alt === null ? "rejected by the public mempool; alt mempool not checked"
    : pub ? "public mempool only"
    : "rejected by both mempools";

  // alt-mempool findings first, then public, then both
  const rank = (f: Finding) => (f.mempool === "alt" ? 0 : f.mempool === "both" ? 1 : 2);
  const findings = [...all].sort((a, b) => rank(a) - rank(b));
  return { publicMempool, altMempool, findings, warnings: warn, summary };
}
