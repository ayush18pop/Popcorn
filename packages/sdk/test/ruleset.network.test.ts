// Rule-set network tests (local devnet): rule-set rule contracts deployed through the SDK, triggered for real, with gas and mempool class
// measured per leaf and per composition shape. Skipped unless POPCORN_NETWORK=1 and the local devnet answers.
//   POPCORN_NETWORK=1 POPCORN_DEVNET=local bun run --cwd packages/sdk vitest run test/ruleset.network.test.ts
// Keys: dev-3 deploys and triggers, dev-4 changes the fixture contract's state (separate nonce lane). Read from
// POPCORN_KEYS_DIR, else devnet/keys; never copied anywhere.
// Results (every number with where it came from) -> test/results/ruleset.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeDeployData, encodeFunctionData, http, keccak256, parseEther, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sendTransaction, waitForTransactionReceipt } from "viem/actions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devnetChain, popcorn, STAKING_REGISTRY, type RuleContractInfo } from "../src/index.ts";
import {
  always,
  and,
  above,
  below,
  codeChanged,
  compare,
  crossing,
  delta,
  erc20,
  ethBalance,
  getter,
  inRange,
  kOfN,
  not,
  or,
  predicate,
  ratio,
  ruleSet,
  stateFlag,
  storage,
  callAction,
  type Node,
  type RuleSetSpec,
} from "../src/ruleset/spec.ts";
import { RuleSetInvalid, encodeRuleSet, encodeRuleSetUnchecked, validateRuleSet } from "../src/ruleset/encode.ts";
import { explainRule, ruleSetAbi, witnessFor } from "../src/ruleset/explain.ts";
import { deployRuleSet, leafClass, planRuleSet, ruleClasses } from "../src/ruleset/deploy.ts";
import { ensureRuleSetInfrastructure, publishRuleSet, predictRuleSetInfrastructure } from "../src/ruleset/infra.ts";
import { orHint, triggerDataFor, encodeWitness } from "../src/ruleset/witness.ts";
import { ruleSetPublisherAbi, ruleSetRuleContractAbi, ruleSetRuleContractBytecode } from "../src/artifacts/ruleset.generated.ts";

const ROOT = new URL("../../../", import.meta.url).pathname;
const RESULTS = new URL("./results/", import.meta.url).pathname;
const KEYS_DIRS = [process.env.POPCORN_KEYS_DIR, `${ROOT}devnet/keys`, resolve(ROOT, "../../popcorn/local/keys")].filter(Boolean) as string[];
const KEYS = KEYS_DIRS.find((d) => existsSync(`${d}/dev-3.json`) && existsSync(`${d}/dev-4.json`));
const WANTED = process.env.POPCORN_NETWORK === "1";
const chain = devnetChain("local");

async function chainUp(): Promise<boolean> {
  try {
    const r = await fetch("http://127.0.0.1:18545", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }), signal: AbortSignal.timeout(3000) });
    return (await r.json()).result === "0x53a";
  } catch {
    return false;
  }
}
const ON = WANTED && !!KEYS && (await chainUp());
if (WANTED && !ON) console.warn(`[ruleset.network] SKIPPED: ${!KEYS ? `dev-3/dev-4 key files not found (looked in ${KEYS_DIRS.join(", ")}; set POPCORN_KEYS_DIR)` : "the local devnet (chain id 1338 at 127.0.0.1:18545) is not answering"}`);

const DUMMY: Hex = "0x0000000000000000000000000000000000000000000000000000000000000001";
const keyOf = (n: number): Hex => (ON ? (JSON.parse(readFileSync(`${KEYS}/dev-${n}.json`, "utf8")) as { private_key: Hex }[])[0]!.private_key : DUMMY);
const art = (n: string, f: string): { bytecode: { object: Hex }; abi: readonly unknown[] } => JSON.parse(readFileSync(`${ROOT}contracts/out/${f}.sol/${n}.json`, "utf8"));
const j = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
const EPOCH_BASE = BigInt(keccak256(toHex("popcorn.ruleset.epoch")));
const slotHex = (n: bigint): Hex => toHex(n, { size: 32 });
const STAKE = parseEther("0.011");
const FUND = parseEther("0.4");

interface TriggerTry {
  admitted: boolean;
  /** Error class + message when not admitted. */
  error?: string;
  hash?: Hex;
  state?: string;
  block?: string;
  /** frame 0 gas in the receipt (on-chain), frame 1 (the action). */
  receiptVerifyGas?: string;
  receiptSenderGas?: string;
  receiptStatus?: string;
  /** ethrex simulate of the exact tx before sending */
  simVerifyGas?: string;
  canonical?: boolean;
}

describe.skipIf(!ON)("T1 rule sets on the local devnet", () => {
  const acct3 = privateKeyToAccount(keyOf(3));
  const acct4 = privateKeyToAccount(keyOf(4));
  const w = createWalletClient({ account: acct3, chain, transport: http() }).extend(popcorn({ devnet: "local" }));
  const w4 = createWalletClient({ account: acct4, chain, transport: http() });
  const noAccount = createPublicClient({ chain, transport: http() }).extend(popcorn({ devnet: "local" }));
  const pub = createPublicClient({ chain, transport: http() });
  const ctx = w.popcorn;
  const gaugeArt = art("MockGauge", "RuleSetMocks");
  let G: Address, P: Address, B: Address, R: Address;
  const out: Record<string, unknown> = { at: new Date().toISOString(), devnet: "local", chainId: 1338 };
  const rows: Record<string, unknown>[] = [];
  let infra: Awaited<ReturnType<typeof ensureRuleSetInfrastructure>>;

  afterAll(() => {
    mkdirSync(RESULTS, { recursive: true });
    out.rows = rows;
    writeFileSync(`${RESULTS}ruleset.json`, JSON.stringify(j(out), null, 2) + "\n");
  });

  const deployPlain = async (name: string): Promise<Address> => {
    const a = art(name, "RuleSetMocks");
    const h = await sendTransaction(w, { data: a.bytecode.object, gas: 3_000_000n } as never);
    return (await waitForTransactionReceipt(pub, { hash: h })).contractAddress!;
  };
  const gset = async (fn: string, ...args: unknown[]) => {
    const h = await w4.writeContract({ address: G, abi: gaugeArt.abi as never, functionName: fn, args: args as never, gas: 500_000n } as never);
    await waitForTransactionReceipt(pub, { hash: h });
  };
  const gread = (fn: string, ...args: unknown[]) => pub.readContract({ address: G, abi: gaugeArt.abi as never, functionName: fn, args: args as never } as never) as Promise<bigint>;

  async function mk(spec: RuleSetSpec, o: { stake?: boolean; stakeCapable?: boolean; fund?: bigint } = {}) {
    return deployRuleSet(ctx, spec, {
      fund: o.fund ?? FUND,
      ...(o.stake ? { stake: true } : {}),
      ...(o.stakeCapable ? { stakeAmount: STAKE } : {}),
    });
  }

  async function tryTrigger(ruleContract: Address, o: { ruleId?: number; verifyData?: Hex; triggerData?: Hex; via?: "rpc" | "sidecar" | "gateway"; nonceKey?: bigint } = {}): Promise<TriggerTry> {
    try {
      const r = await w.triggerDetailed(ruleContract, { triggerData: o.triggerData ?? triggerDataFor(o.ruleId ?? 0), verifyData: o.verifyData ?? "0x", via: o.via ?? "sidecar", ...(o.nonceKey !== undefined ? { nonceKey: o.nonceKey } : {}) });
      const st = await w.watch(r.hash, { timeoutMs: 150_000 });
      const base: TriggerTry = { admitted: true, hash: r.hash, state: st.state, ...(r.prepared.verifyGasUsed !== null ? { simVerifyGas: String(r.prepared.verifyGasUsed) } : {}), canonical: r.prepared.readiness.canonical };
      if (st.state === "included") {
        base.block = String(st.blockNumber);
        base.receiptStatus = st.status;
        base.receiptVerifyGas = String(st.receipt.frameReceipts[0]?.gasUsed);
        base.receiptSenderGas = String(st.receipt.frameReceipts[1]?.gasUsed);
      }
      return base;
    } catch (e) {
      return { admitted: false, error: `${(e as Error).name}: ${(e as Error).message.slice(0, 400)}` };
    }
  }

  beforeAll(async () => {
    G = await deployPlain("MockGauge");
    P = await deployPlain("MockSigner");
    B = await deployPlain("MockBurner");
    R = await deployPlain("MockReverter");
    out.fixtures = { gauge: G, predicate: P, burner: B, reverter: R };
    infra = await ensureRuleSetInfrastructure(ctx, { stakeAmount: STAKE });
  }, 600_000);

  // ================================================================ infrastructure and costs
  it("deploys the shared publisher and logic through the CREATE2 proxy at the predicted addresses; reuse costs nothing", async () => {
    const pred = predictRuleSetInfrastructure(STAKE);
    expect(infra.publisher).toBe(pred.publisher);
    expect(infra.logic).toBe(pred.logic);
    const again = await ensureRuleSetInfrastructure(ctx, { stakeAmount: STAKE });
    expect(again.txHashes).toEqual([]);
    const gas: Record<string, string> = {};
    for (const h of infra.txHashes) gas[h] = String((await pub.getTransactionReceipt({ hash: h })).gasUsed);
    out.infrastructure = { publisher: infra.publisher, logic: infra.logic, stakeAmount: STAKE, deployTxs: gas, source: "on-chain receipts (gasUsed)" };
  }, 300_000);

  it("config size vs publish gas, and shared vs per-config logic deployment cost (measured receipts)", async () => {
    const small = encodeRuleSet(ruleSet("independent", { when: always(true) }));
    const big = encodeRuleSet(ruleSet("independent", { when: and(...Array.from({ length: 12 }, (_, i) => above(getter(G, "value()"), BigInt(1000 + i)))) }));
    const rs = [];
    for (const c of [small, big]) {
      const p = await publishRuleSet(ctx, infra.publisher, c);
      rs.push({ configBytes: (c.length - 2) / 2, publishGas: p.gasUsed === null ? "already published" : String(p.gasUsed), tx: p.txHash });
    }
    // per-config logic: bytecode + constructor(config, stake)
    const data = encodeDeployData({ abi: ruleSetRuleContractAbi, bytecode: ruleSetRuleContractBytecode, args: [small, 0n] } as never);
    const h = await sendTransaction(w, { data, gas: 40_000_000n } as never);
    const rc = await waitForTransactionReceipt(pub, { hash: h });
    expect(rc.status).toBe("success");
    out.deployCost = { publish: rs, perConfigLogicDeploy: { configBytes: (small.length - 2) / 2, gasUsed: String(rc.gasUsed), tx: h }, source: "on-chain receipts" };
  }, 300_000);

  // ================================================================ leaf families
  interface Fam {
    key: string;
    label: string;
    spec: () => RuleSetSpec;
    ruleId?: number;
    /** runs before trigger `step` (0-based) of the family's measured triggers; rule contract address given */
    arm: (ruleContract: Address, step: number) => Promise<void>;
    prelude?: (ruleContract: Address) => Promise<void>;
    fires: number;
    witness?: Hex;
  }
  const val = () => getter(G, "value()");
  const oth = () => getter(G, "other()");
  const rule3 = (when: Node, extra: Partial<{ maxFires: number }> = {}) => ruleSet("independent", { when, maxFires: extra.maxFires ?? 3 });
  const noop = async () => {};
  const predicateWitness: Hex = toHex("signature-bytes");
  const families: Fam[] = [
    { key: "const", label: "constant true (baseline)", spec: () => rule3(always(true)), arm: noop, fires: 3 },
    {
      key: "storage",
      label: "own storage compare (the rule contract's rule-0 epoch slot >= 1)",
      spec: () => ruleSet("independent", { when: always(true), maxFires: 1 }, { when: compare(storage(slotHex(EPOCH_BASE)), "ge", 1n), maxFires: 3 }),
      ruleId: 1,
      arm: noop,
      prelude: async (k) => {
        const t = await tryTrigger(k, { ruleId: 0, via: "rpc" });
        expect(t.state, JSON.stringify(t)).toBe("included");
      },
      fires: 3,
    },
    { key: "getter", label: "another contract's getter compare (value() > 100)", spec: () => rule3(above(val(), 100n)), arm: async () => gset("setValue", 500n), fires: 3 },
    { key: "range", label: "range inside [100, 200]", spec: () => rule3(inRange(val(), 100n, 200n)), arm: async () => gset("setValue", 150n), fires: 3 },
    {
      key: "crossing",
      label: "crossing line 100 either way (baseline 50), re-armed by each trigger",
      spec: () => rule3(crossing(val(), 100n, "either", { initial: 50n })),
      arm: async (_k, step) => gset("setValue", step % 2 === 0 ? 150n : 40n),
      fires: 3,
    },
    {
      key: "delta",
      label: "delta +10% since the checkpoint (baseline 1000), re-armed by each trigger",
      spec: () => rule3(delta(val(), 1000, "up", { initial: 1000n })),
      arm: async (_k, step) => gset("setValue", [1200n, 1440n, 1728n][step]!),
      fires: 3,
    },
    { key: "ratio", label: "ratio value/other >= 3/2", spec: () => rule3(ratio(val(), oth(), "ge", 3n, 2n)), arm: async () => { await gset("setValue", 300n); await gset("setOther", 100n); }, fires: 3 },
    { key: "erc20Self", label: "ERC-20 balanceOf(rule contract) >= 500", spec: () => rule3(compare(erc20(G, "self"), "ge", 500n)), arm: async (k) => gset("setBalance", k, 500n), fires: 3 },
    { key: "erc20Other", label: "ERC-20 balanceOf(other account) < 10", spec: () => rule3(compare(erc20(G, acct4.address), "lt", 10n)), arm: noop, fires: 3 },
    { key: "ethSelf", label: "ETH balance of the rule contract >= 0.1", spec: () => rule3(compare(ethBalance("self"), "ge", parseEther("0.1"))), arm: noop, fires: 3 },
    { key: "ethOther", label: "ETH balance of another account > 1", spec: () => rule3(compare(ethBalance(acct4.address), "gt", parseEther("1"))), arm: noop, fires: 3 },
    { key: "codeHash", label: "code hash of a contract changed (recorded hash differs)", spec: () => rule3(codeChanged(G, keccak256(toHex("some other code")))), arm: noop, fires: 3 },
    { key: "flag", label: "state flag paused() == true", spec: () => rule3(stateFlag(G, "paused()", true)), arm: async () => gset("setPaused", true), fires: 3 },
    {
      key: "predicate",
      label: "external predicate (mock, accepts the witness)",
      spec: () => rule3(predicate(P, { params: encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }], [keccak256(predicateWitness), `0x${"00".repeat(32)}`, "0x0000000000000000000000000000000000000000"]), maxWitnessBytes: 32 })),
      witness: encodeWitness([{ nodeId: 0, data: predicateWitness }]),
      arm: noop,
      fires: 3,
    },
  ];

  for (const fam of families) {
    it(`leaf family: ${fam.key}: gas, public / unstaked / staked class, included triggers`, async () => {
      const spec = fam.spec();
      const plan = planRuleSet(spec, { stake: true });
      const d = await mk(spec, { stakeCapable: true });
      const K = d.ruleContract;
      const ruleId = fam.ruleId ?? 0;
      const row: Record<string, unknown> = { family: fam.key, label: fam.label, ruleContract: K, createTx: d.txHash, pointer: d.pointer, caps: j(d.args), estimatedConditionWorstCase: plan.gas[ruleId]!.condition, class: j(ruleClasses(spec)[ruleId]), publishGas: d.publishGas === null ? null : String(d.publishGas) };
      if (fam.prelude) await fam.prelude(K);
      await fam.arm(K, 0);
      // 1. ethrex simulate of the exact trigger
      const sim = await w.simulate(K, { triggerData: triggerDataFor(ruleId), verifyData: fam.witness ?? "0x" });
      row.simulate = { ready: sim.report.summary, verifyGas: String(sim.ethrex.verifyGas), canonical: sim.ethrex.canonicalMempoolValid, violation: sim.ethrex.canonicalMempoolViolation, valid: sim.ethrex.valid, source: "ethrex_simulateFrameTransaction frame 0 gasUsed" };
      expect(sim.ethrex.valid, sim.text).toBe(true);
      // the model's worst-case condition gas covers what was measured (8,598 = bisected const condition; deltas are exact)
      expect(plan.gas[ruleId]!.condition, `${fam.key}: estimate below measured`).toBeGreaterThanOrEqual(8_598 + Number(sim.ethrex.verifyGas! - 38_828n));
      const cls = ruleClasses(spec)[ruleId]!;
      expect(sim.ethrex.canonicalMempoolValid, `${fam.key}: canonicalMempoolValid vs the class table (${sim.ethrex.canonicalMempoolViolation})`).toBe(cls.publicMempool);
      // 2. the public route (ethrex's own mempool: canonical rules, 250k locally)
      let used = 0;
      const pubTry = await tryTrigger(K, { ruleId, verifyData: fam.witness ?? "0x", via: "rpc" });
      row.publicRoute = pubTry;
      if (cls.publicMempool) {
        expect(pubTry.state, JSON.stringify(pubTry)).toBe("included");
        used++;
      } else expect(pubTry.admitted, `${fam.key} must be refused by public ethrex`).toBe(false);
      // 3. sidecar, unstaked
      if (used > 0) await fam.arm(K, used);
      const uns = await tryTrigger(K, { ruleId, verifyData: fam.witness ?? "0x", via: "sidecar" });
      row.sidecarUnstaked = uns;
      if (cls.unstaked) {
        expect(uns.state, JSON.stringify(uns)).toBe("included");
        used++;
      } else expect(uns.admitted, `${fam.key} must be refused by the sidecar unstaked`).toBe(false);
      // 4. staked: only needed to show the refused ones become admitted
      if (!cls.unstaked) {
        const st = await w.stakeRule(K);
        expect(st.staked).toBe(true);
        row.stake = { tx: st.txHash, amount: st.amount, registry: st.registry };
        await fam.arm(K, used);
        const stk = await tryTrigger(K, { ruleId, verifyData: fam.witness ?? "0x", via: "sidecar" });
        row.sidecarStaked = stk;
        expect(stk.state, JSON.stringify(stk)).toBe("included");
        used++;
      }
      row.firesUsed = used;
      rows.push(row);
    }, 900_000);
  }

  // ================================================================ compositions
  interface Shape {
    key: string;
    spec: () => RuleSetSpec;
    arm: () => Promise<void>;
    ruleId?: number;
  }
  const paused = () => stateFlag(G, "paused()", true);
  const shapes: Shape[] = [
    { key: "and2", spec: () => rule3(and(above(val(), 10n), below(oth(), 100n)), { maxFires: 1 }), arm: async () => { await gset("setValue", 50n); await gset("setOther", 1n); } },
    { key: "or2-hint", spec: () => rule3(or(above(val(), 1000n), below(oth(), 5n)), { maxFires: 1 }), arm: async () => { await gset("setValue", 5n); await gset("setOther", 1n); } },
    { key: "not", spec: () => rule3(not(paused()), { maxFires: 1 }), arm: async () => gset("setPaused", false) },
    { key: "2-of-3", spec: () => rule3(kOfN(2, above(val(), 10n), above(oth(), 10n), paused()), { maxFires: 1 }), arm: async () => { await gset("setValue", 50n); await gset("setOther", 50n); await gset("setPaused", false); } },
    {
      key: "nested",
      spec: () => rule3(and(above(val(), 10n), or(paused(), below(oth(), 5n)), not(kOfN(2, above(val(), 100n), above(oth(), 100n), paused()))), { maxFires: 1 }),
      arm: async () => { await gset("setValue", 50n); await gset("setOther", 1n); await gset("setPaused", false); },
    },
  ];
  const shapeRuleContracts: Record<string, Address> = {};
  for (const sh of shapes) {
    it(`composition: ${sh.key}: gas, included trigger (staked rule contract)`, async () => {
      const spec = sh.spec();
      const plan = planRuleSet(spec, { stake: true });
      const d = await mk(spec, { stake: true });
      shapeRuleContracts[sh.key] = d.ruleContract;
      await sh.arm();
      const { verifyData, explanation } = await witnessFor(ctx, d.ruleContract, { ruleId: 0 });
      expect(explanation.wouldPass, explanation.text).toBe(true);
      const sim = await w.simulate(d.ruleContract, { triggerData: triggerDataFor(0), verifyData });
      expect(sim.ethrex.valid, sim.text).toBe(true);
      expect(plan.gas[0]!.condition, `${sh.key}: estimate below measured`).toBeGreaterThanOrEqual(8_598 + Number(sim.ethrex.verifyGas! - 38_828n));
      const t = await tryTrigger(d.ruleContract, { verifyData, via: "sidecar" });
      expect(t.state, JSON.stringify(t)).toBe("included");
      rows.push({ shape: sh.key, ruleContract: d.ruleContract, createTx: d.txHash, nodes: explanation.nodes.length, witnessBytes: (verifyData.length - 2) / 2, hints: explanation.hints.length, estimatedConditionWorstCase: plan.gas[0]!.condition, class: j(ruleClasses(spec)[0]), simulate: { verifyGas: String(sim.ethrex.verifyGas), canonical: sim.ethrex.canonicalMempoolValid, source: "ethrex_simulateFrameTransaction frame 0 gasUsed" }, trigger: t, stakeTx: d.stake?.txHash });
    }, 900_000);
  }

  it("OR with a wrong hint is refused at admission and costs nothing; the debug view says why", async () => {
    const K = shapeRuleContracts["or2-hint"]!;
    // a fresh rule contract (the shape's one-shot is spent): same spec, armed
    const d = await mk(shapes[1]!.spec(), { stake: true });
    await shapes[1]!.arm();
    const bal0 = await pub.getBalance({ address: d.ruleContract });
    const good = (await witnessFor(ctx, d.ruleContract, { ruleId: 0 })).verifyData;
    expect(good).toBe(encodeWitness([orHint(0, 1)]));
    const wrong = encodeWitness([orHint(0, 0)]);
    const ready = await noAccount.canTrigger(d.ruleContract, { triggerData: triggerDataFor(0), verifyData: wrong });
    expect(ready.ready).toBe(false);
    expect(ready.name).toBe("CONDITION_FALSE");
    // the sidecar's own verdict on the wrong-hint trigger (submitted directly: simulate({ sidecar: true }) sends it)
    const s = await w.simulate(d.ruleContract, { triggerData: triggerDataFor(0), verifyData: wrong, sidecar: true });
    expect(s.sidecar?.admitted).toBe(false);
    expect(await pub.getBalance({ address: d.ruleContract })).toBe(bal0);
    const ex = await explainRule(ctx, d.ruleContract, { ruleId: 0, verifyData: wrong });
    expect(ex.wouldPass).toBe(false);
    expect(ex.nodes.map((n) => n.result)).toEqual(["true", "false", "true"]); // OR true as a node, but the hint names the false child
    const ex2 = await explainRule(ctx, d.ruleContract, { ruleId: 0 });
    expect(ex2.hints).toEqual([orHint(0, 1)]);
    rows.push({ negative: "wrong OR hint", ruleContract: d.ruleContract, ruleContractUsedForShape: K, ethrex: { ready: ready.ready, name: ready.name, reason: ready.reason }, sidecar: s.sidecar, ruleContractBalanceUnchanged: true, debug: ex.text });
    // with the right hint it passes and is included
    const t = await tryTrigger(d.ruleContract, { verifyData: good });
    expect(t.state, JSON.stringify(t)).toBe("included");
    rows.push({ negative: "right OR hint (same rule contract)", trigger: t });
  }, 900_000);

  // ---------------------------------------------------------------- rule sets: else / independent
  it("else-mode rule set: three rules, each fires once, a second trigger of the same event is refused (key consumed); actions run", async () => {
    const ping = (n: bigint) => callAction(G, { data: encodeFunctionData({ abi: gaugeArt.abi as never, functionName: "ping", args: [n] } as never), gas: 100_000 });
    const spec = ruleSet(
      "else",
      { name: "high", when: above(val(), 100n), maxFires: 1, action: ping(1n) },
      { name: "mid", when: above(val(), 10n), maxFires: 1, action: ping(2n) },
      { name: "default", when: always(true), maxFires: 1, action: ping(3n) },
    );
    const d = await mk(spec, { stake: true });
    const K = d.ruleContract;
    const pings0 = Number(await gread("pings"));
    const out3: Record<string, unknown> = {};
    // value 500: rule 0 passes; rules 1 and 2 are refused although their own trees are true (the else)
    await gset("setValue", 500n);
    expect((await noAccount.canTrigger(K, { triggerData: triggerDataFor(0) })).ready).toBe(true);
    expect((await noAccount.canTrigger(K, { triggerData: triggerDataFor(1) })).ready).toBe(false);
    expect((await noAccount.canTrigger(K, { triggerData: triggerDataFor(2) })).ready).toBe(false);
    const key0 = (await noAccount.canTrigger(K, { triggerData: triggerDataFor(0) })).nonceKey;
    const t0 = await tryTrigger(K, { ruleId: 0 });
    expect(t0.state, JSON.stringify(t0)).toBe("included");
    out3.rule0 = t0;
    // same event again: refused (maxFires 1) ...
    expect((await noAccount.canTrigger(K, { triggerData: triggerDataFor(0) })).ready).toBe(false);
    // ... and the consumed key itself is refused by the nonce check
    const replay = await tryTrigger(K, { ruleId: 0, nonceKey: key0 });
    expect(replay.admitted).toBe(false);
    out3.rule0SecondPop = replay;
    // value 50 -> rule 1
    await gset("setValue", 50n);
    expect((await noAccount.canTrigger(K, { triggerData: triggerDataFor(1) })).ready).toBe(true);
    const t1 = await tryTrigger(K, { ruleId: 1 });
    expect(t1.state, JSON.stringify(t1)).toBe("included");
    out3.rule1 = t1;
    expect((await noAccount.canTrigger(K, { triggerData: triggerDataFor(1) })).ready).toBe(false);
    // value 5 -> default
    await gset("setValue", 5n);
    expect((await noAccount.canTrigger(K, { triggerData: triggerDataFor(2) })).ready).toBe(true);
    const t2 = await tryTrigger(K, { ruleId: 2 });
    expect(t2.state, JSON.stringify(t2)).toBe("included");
    out3.rule2 = t2;
    expect((await noAccount.canTrigger(K, { triggerData: triggerDataFor(2) })).ready).toBe(false);
    // actions ran: ping(1), ping(2), ping(3)
    expect(Number(await gread("pings")) - pings0).toBe(3);
    expect(Number(await gread("lastArg"))).toBe(3);
    expect(await pub.readContract({ address: K, abi: ruleSetAbi, functionName: "ruleEpoch", args: [0n] })).toBe(1n);
    rows.push({ shape: "else-mode 3 rules", ruleContract: K, createTx: d.txHash, stakeTx: d.stake?.txHash, pops: out3 });
    shapeRuleContracts["else"] = K;
  }, 900_000);

  it("independent-mode rule set: two rules true at once, both fire; gas else vs independent for the same last rule", async () => {
    const mkSet = (mode: "independent" | "else") => ruleSet(mode, { when: above(val(), 100n), maxFires: 1 }, { when: above(val(), 10n), maxFires: 1 }, { when: always(true), maxFires: 1 });
    const ind = await mk(mkSet("independent"), { stake: true });
    const els = await mk(mkSet("else"), { stake: true });
    await gset("setValue", 500n);
    const a = await tryTrigger(ind.ruleContract, { ruleId: 0 });
    const b = await tryTrigger(ind.ruleContract, { ruleId: 1 });
    const c = await tryTrigger(ind.ruleContract, { ruleId: 2 });
    for (const t of [a, b, c]) expect(t.state, JSON.stringify(t)).toBe("included");
    // else: only rule 0 while value is 500
    expect((await noAccount.canTrigger(els.ruleContract, { triggerData: triggerDataFor(1) })).ready).toBe(false);
    expect((await noAccount.canTrigger(els.ruleContract, { triggerData: triggerDataFor(2) })).ready).toBe(false);
    // gas of the LAST rule: set value 5 so rule 2 is true in the else set (rules 0 and 1 definitely false) and in the independent one
    await gset("setValue", 5n);
    const mk2 = async (kk: Address) => {
      const s = await w.simulate(kk, { triggerData: triggerDataFor(2) });
      expect(s.ethrex.valid, s.text).toBe(true);
      return String(s.ethrex.verifyGas);
    };
    const ind2 = await mk(mkSet("independent"), { stake: true });
    const els2 = await mk(mkSet("else"), { stake: true });
    const g_ind = await mk2(ind2.ruleContract);
    const g_els = await mk2(els2.ruleContract);
    expect(BigInt(g_els)).toBeGreaterThan(BigInt(g_ind));
    rows.push({ shape: "independent 3 rules", ruleContract: ind.ruleContract, pops: { rule0: a, rule1: b, rule2: c }, elseRefusedWhileRule0True: true });
    rows.push({ shape: "else vs independent, rule 2 (value 5: the two earlier trees are evaluated exactly in else mode)", independentVerifyGas: g_ind, elseVerifyGas: g_els, difference: String(BigInt(g_els) - BigInt(g_ind)), source: "ethrex_simulateFrameTransaction frame 0 gasUsed" });
  }, 900_000);

  it("a tree of own-storage leaves only is public-mempool class: nested AND/OR/NOT included through public ethrex", async () => {
    const E0 = slotHex(EPOCH_BASE);
    const E1 = slotHex(EPOCH_BASE + 1n);
    // a rule's word is epoch | fires << 128: "fired once" is >= 1 << 128
    const F = 1n << 128n;
    const tree = and(compare(storage(E0), "ge", F), or(compare(storage(E1), "ge", 99n * F), compare(storage(E1), "ge", F)), not(compare(storage(E1), "ge", 2n * F)));
    const spec = ruleSet("independent", { when: always(true), maxFires: 1 }, { when: always(true), maxFires: 2 }, { when: tree, maxFires: 1 });
    const d = await mk(spec);
    const K = d.ruleContract;
    expect(ruleClasses(spec)[2]!.publicMempool).toBe(true);
    expect((await tryTrigger(K, { ruleId: 0, via: "rpc" })).state).toBe("included");
    expect((await tryTrigger(K, { ruleId: 1, via: "rpc" })).state).toBe("included");
    const { verifyData, explanation } = await witnessFor(ctx, K, { ruleId: 2 });
    expect(explanation.wouldPass, explanation.text).toBe(true);
    const sim = await w.simulate(K, { triggerData: triggerDataFor(2), verifyData });
    expect(sim.ethrex.valid, sim.text + JSON.stringify(j({ e: sim.ethrex, caps: d.args, hint: explanation.hints }))).toBe(true);
    expect(sim.ethrex.canonicalMempoolValid, String(sim.ethrex.canonicalMempoolViolation)).toBe(true);
    const t = await tryTrigger(K, { ruleId: 2, verifyData, via: "rpc" });
    expect(t.state, JSON.stringify(t)).toBe("included");
    rows.push({ shape: "own-storage nested tree (public mempool)", ruleContract: K, createTx: d.txHash, simulate: { verifyGas: String(sim.ethrex.verifyGas), canonical: true }, trigger: t });
  }, 900_000);

  // ================================================================ fail closed, caps, predicate replay
  it("NOT over a reverting getter does not fire (unknown is not false); the debug view shows 'unknown'", async () => {
    const spec = rule3(not(compare(getter(R, "value()"), "ge", 0n)));
    const d = await mk(spec);
    const r = await noAccount.canTrigger(d.ruleContract, { triggerData: triggerDataFor(0) });
    expect(r.ready).toBe(false);
    const ex = await explainRule(ctx, d.ruleContract, { ruleId: 0 });
    expect(ex.nodes.map((n) => n.result)).toEqual(["unknown", "unknown"]);
    rows.push({ negative: "NOT(reverting getter)", ruleContract: d.ruleContract, canTrigger: { ready: r.ready, name: r.name }, debug: ex.text });
  }, 600_000);

  it("a gas-burning read is cut at its cap: k-of-n(1, [burner, true]) at caps 10k and 50k (worst-case calibration)", async () => {
    const cal: Record<string, unknown>[] = [];
    let base: bigint | null = null;
    {
      const d = await mk(rule3(always(true)));
      const s = await w.simulate(d.ruleContract, { triggerData: triggerDataFor(0) });
      base = s.ethrex.verifyGas;
    }
    for (const cap of [10_000, 50_000]) {
      const leaf = compare(getter(B, "value()", { gas: cap }), "ge", 0n);
      const spec = rule3(kOfN(1, leaf, always(true)));
      const d = await mk(spec);
      const s = await w.simulate(d.ruleContract, { triggerData: triggerDataFor(0) });
      expect(s.ethrex.valid, s.text).toBe(true);
      const plan = planRuleSet(spec);
      const t = await tryTrigger(d.ruleContract, { via: "rpc" });
      cal.push({ cap, verifyGas: String(s.ethrex.verifyGas), minusConstBaseline: String(s.ethrex.verifyGas! - base!), estimatedConditionWorstCase: plan.gas[0]!.condition, canonical: s.ethrex.canonicalMempoolValid, trigger: t });
    }
    const c0 = BigInt((cal[0] as { minusConstBaseline: string }).minusConstBaseline);
    const c1 = BigInt((cal[1] as { minusConstBaseline: string }).minusConstBaseline);
    // 40,000 more cap -> 40,000 more gas (the burner really runs to its cap)
    expect(c1 - c0).toBeGreaterThanOrEqual(39_000n);
    expect(c1 - c0).toBeLessThanOrEqual(41_000n);
    out.calibration = { constBaselineVerifyGas: String(base), rows: cal, source: "ethrex_simulateFrameTransaction frame 0 gasUsed; included triggers: receipt frame 0" };
  }, 900_000);

  it("calibration: per-node overhead from structure-only rule contracts (VERIFY deltas against the const rule contract)", async () => {
    const T = () => always(true);
    const many = (n: number) => Array.from({ length: n }, T);
    const nots = (n: number): Node => Array.from({ length: n }).reduce<Node>((x) => not(x), always(false));
    const slotN = (i: number) => compare(storage(slotHex(BigInt(keccak256(toHex(`calib${i}`))))), "ge", 0n);
    const sameSlot = () => compare(storage(slotHex(EPOCH_BASE)), "ge", 0n);
    const cases: { key: string; tree: Node; nodes: number; hint?: number }[] = [
      { key: "const", tree: T(), nodes: 1 },
      { key: "and16-const", tree: and(...many(16)), nodes: 17 },
      { key: "or16-const-hint15", tree: or(...many(16)), nodes: 17, hint: 15 },
      { key: "not(const false)", tree: not(always(false)), nodes: 2 },
      { key: "7 nested NOT", tree: nots(7), nodes: 8 },
      { key: "kofn(8 of 16 const)", tree: kOfN(8, ...many(16)), nodes: 17 },
      { key: "and16-storage-distinct-cold", tree: and(...Array.from({ length: 16 }, (_, i) => slotN(i))), nodes: 17 },
      { key: "and16-storage-same-slot", tree: and(...Array.from({ length: 16 }, sameSlot)), nodes: 17 },
      { key: "and16 ratio-free cmp ethBalance(self)", tree: and(...Array.from({ length: 4 }, () => compare(ethBalance("self"), "ge", 0n))), nodes: 5 },
    ];
    const res: Record<string, unknown>[] = [];
    let base = 0n;
    for (const c of cases) {
      const spec = rule3(c.tree);
      const d = await deployRuleSet(ctx, spec, { fund: FUND, caps: { conditionGas: 120_000 } }); // generous: this test measures use, not the estimate
      const verifyData = c.hint !== undefined ? encodeWitness([orHint(0, c.hint)]) : "0x";
      const s = await w.simulate(d.ruleContract, { triggerData: triggerDataFor(0), verifyData });
      expect(s.ethrex.valid, `${c.key}: ${s.text}`).toBe(true);
      const v = s.ethrex.verifyGas!;
      if (c.key === "const") base = v;
      const plan = planRuleSet(spec);
      res.push({ key: c.key, nodes: c.nodes, configBytes: plan.configBytes, verifyGas: String(v), deltaVsConst: String(v - base), estimatedCondition: plan.gas[0]!.condition, impliedCondition: String(8_598n + v - base) });
    }
    out.structure = { rows: res, constConditionGas: 8598, source: "ethrex_simulateFrameTransaction frame 0 gasUsed; implied condition = 8,598 (bisected const) + delta" };
    for (const r of res as { key: string; estimatedCondition: number; impliedCondition: string }[]) expect(r.estimatedCondition, `${r.key}: model below measured`).toBeGreaterThanOrEqual(Number(r.impliedCondition));
  }, 1_200_000);

  it("calibration: the condition's own gas = the smallest conditionGas that still triggers (bisection), const and one getter leaf", async () => {
    // The logic gets exactly `conditionGas` (Core delegatecalls it with that fixed amount), so the smallest conditionGas for
    // which the trigger is still valid IS the condition's gas use. Resolution 25 gas.
    const search = async (spec: RuleSetSpec, arm: () => Promise<void>, hi: number): Promise<{ min: number; deploys: number }> => {
      let lo = 5_000;
      let deploys = 0;
      await arm();
      while (hi - lo > 25) {
        const mid = Math.floor((lo + hi) / 2);
        const d = await deployRuleSet(ctx, spec, { fund: FUND, caps: { conditionGas: mid } });
        deploys++;
        const r = await noAccount.canTrigger(d.ruleContract, { triggerData: triggerDataFor(0) });
        if (r.ready) hi = mid;
        else lo = mid;
      }
      return { min: hi, deploys };
    };
    const constSpec = rule3(always(true));
    const getterSpec = rule3(above(val(), 100n));
    const c = await search(constSpec, async () => {}, planRuleSet(constSpec).caps.conditionGas);
    const gt = await search(getterSpec, async () => gset("setValue", 500n), planRuleSet(getterSpec).caps.conditionGas);
    const verifyConst = BigInt(((rows.find((r) => r.family === "const") as { simulate: { verifyGas: string } } | undefined)?.simulate.verifyGas) ?? "38828");
    const verifyGetter = BigInt(((rows.find((r) => r.family === "getter") as { simulate: { verifyGas: string } } | undefined)?.simulate.verifyGas) ?? "45726");
    out.conditionGasBisection = {
      const: c,
      getter: gt,
      deltaPredictedFromVerify: String(verifyGetter - verifyConst),
      deltaFromBisection: gt.min - c.min,
      source: "smallest conditionGas for which ethrex_simulateFrameTransaction accepts the trigger (Core gives __condition exactly conditionGas); resolution 25 gas",
    };
    // VERIFY deltas between rule contracts on one logic equal condition deltas (same Core path, same nonceKey): within the 25-gas resolution
    expect(Math.abs(gt.min - c.min - Number(verifyGetter - verifyConst))).toBeLessThanOrEqual(60);
    // and the model's worst case is above both
    expect(planRuleSet(constSpec).gas[0]!.condition).toBeGreaterThanOrEqual(c.min);
    expect(planRuleSet(getterSpec).gas[0]!.condition).toBeGreaterThanOrEqual(gt.min);
  }, 1_800_000);

  // ================================================================ review round: M1, L5, I1
  const toggleArt = art("MockToggle", "RuleSetMocks");
  const rread = (ruleContract: Address, fn: "ruleEpoch" | "ruleFires", id: number) => pub.readContract({ address: ruleContract, abi: ruleSetAbi, functionName: fn, args: [BigInt(id)] }) as Promise<bigint>;

  it("M1: a CALL with a huge gas cap against a burning callee cannot brick the rule (the call is capped to what the frame affords)", async () => {
    const spec = ruleSet("independent", { when: always(true), maxFires: 1, retryOnFailure: false, action: callAction(B, { data: "0x12345678", gas: 5_000_000 }) });
    const d = await deployRuleSet(ctx, spec, { fund: FUND, caps: { maxGasPerFrame: 300_000n } });
    expect(d.plan.warnings.join()).toMatch(/action gas 5000000 is above maxGasPerFrame/);
    const t = await tryTrigger(d.ruleContract);
    expect(t.state, JSON.stringify(t)).toBe("included");
    expect(t.receiptStatus).toBe("success");
    // the SENDER frame finished: epoch advanced, fire counted, key not stuck
    expect(await rread(d.ruleContract, "ruleEpoch", 0)).toBe(1n);
    expect(await rread(d.ruleContract, "ruleFires", 0)).toBe(1n);
    rows.push({ review: "M1 burning callee, call gas 5,000,000, frame cap 300,000", ruleContract: d.ruleContract, trigger: t, epoch: 1, fires: 1, note: "SENDER frame status success; the call was cut to the frame's remaining gas minus the 30,000 reserve" });
  }, 600_000);

  it("M1: retry on failure: a failing callee advances the key but not the fire count; a later success counts; without retry the failure uses the rule up", async () => {
    const T0 = await deployPlain("MockToggle");
    const act = encodeFunctionData({ abi: toggleArt.abi as never, functionName: "act", args: [] } as never);
    const setFailing = async (f: boolean) => waitForTransactionReceipt(pub, { hash: await w4.writeContract({ address: T0, abi: toggleArt.abi as never, functionName: "setFailing", args: [f], gas: 500_000n } as never) });
    const count = async () => (await pub.readContract({ address: T0, abi: toggleArt.abi as never, functionName: "count" } as never)) as bigint;
    await setFailing(true);
    const mkR = (retry: boolean) => ruleSet("independent", { when: always(true), maxFires: 1, retryOnFailure: retry, action: callAction(T0, { data: act, gas: 100_000 }) });
    // retry on
    const a = await deployRuleSet(ctx, mkR(true), { fund: FUND });
    const key0 = (await noAccount.canTrigger(a.ruleContract, { triggerData: triggerDataFor(0) })).nonceKey;
    const p1 = await tryTrigger(a.ruleContract);
    expect(p1.state, JSON.stringify(p1)).toBe("included");
    expect(p1.receiptStatus).toBe("success");
    expect(await rread(a.ruleContract, "ruleEpoch", 0)).toBe(1n);
    expect(await rread(a.ruleContract, "ruleFires", 0)).toBe(0n);
    const r1 = await noAccount.canTrigger(a.ruleContract, { triggerData: triggerDataFor(0) });
    expect(r1.ready).toBe(true);
    expect(r1.nonceKey).not.toBe(key0);
    await setFailing(false);
    const p2 = await tryTrigger(a.ruleContract);
    expect(p2.state, JSON.stringify(p2)).toBe("included");
    expect(await count()).toBe(1n);
    expect(await rread(a.ruleContract, "ruleFires", 0)).toBe(1n);
    expect((await noAccount.canTrigger(a.ruleContract, { triggerData: triggerDataFor(0) })).ready).toBe(false);
    // retry off, callee failing: the trigger uses the rule up
    await setFailing(true);
    const b = await deployRuleSet(ctx, mkR(false), { fund: FUND });
    const p3 = await tryTrigger(b.ruleContract);
    expect(p3.state, JSON.stringify(p3)).toBe("included");
    expect(await rread(b.ruleContract, "ruleFires", 0)).toBe(1n);
    expect((await noAccount.canTrigger(b.ruleContract, { triggerData: triggerDataFor(0) })).ready).toBe(false);
    expect(await count()).toBe(1n);
    rows.push({ review: "M1 retry on failure", toggle: T0, withRetry: { ruleContract: a.ruleContract, failingTrigger: p1, retryTrigger: p2 }, withoutRetry: { ruleContract: b.ruleContract, failingTrigger: p3, readyAfter: false } });
  }, 900_000);

  it("L5: a callee that runs out of state gas: what fails, the call or the whole SENDER frame? (rule contract with exactly one state slot)", async () => {
    const T0 = await deployPlain("MockToggle");
    const store = encodeFunctionData({ abi: toggleArt.abi as never, functionName: "store", args: [1n, 5n] } as never);
    const stored = async () => (await pub.readContract({ address: T0, abi: toggleArt.abi as never, functionName: "stored", args: [1n] } as never)) as bigint;
    const spec = (slots?: number) => ruleSet("independent", { when: always(true), maxFires: 1, retryOnFailure: false, action: callAction(T0, { data: store, gas: 200_000, ...(slots !== undefined ? { stateSlots: slots } : {}) }) });
    // exactly the epoch slot: the callee's fresh slot has no state gas left
    const tight = await deployRuleSet(ctx, spec(), { fund: FUND, caps: { maxStateGasPerFrame: 97_920n } });
    const t1 = await tryTrigger(tight.ruleContract);
    expect(t1.state, JSON.stringify(t1)).toBe("included");
    const outcome = { frameStatus: t1.receiptStatus, calleeStored: String(await stored()), epoch: String(await rread(tight.ruleContract, "ruleEpoch", 0)), fires: String(await rread(tight.ruleContract, "ruleFires", 0)), senderGas: t1.receiptSenderGas };
    // sized by the plan with stateSlots: 1
    const planned = await deployRuleSet(ctx, spec(1), { fund: FUND });
    const t2 = await tryTrigger(planned.ruleContract);
    expect(t2.state, JSON.stringify(t2)).toBe("included");
    expect(t2.receiptStatus).toBe("success");
    expect(await stored()).toBe(5n);
    out.calleeStateGas = { tightRuleContract: { ruleContract: tight.ruleContract, caps: j(tight.args), tx: t1.hash, ...outcome }, plannedRuleContract: { ruleContract: planned.ruleContract, maxStateGasPerFrame: String(planned.args.maxStateGasPerFrame), tx: t2.hash, frameStatus: t2.receiptStatus }, source: "on-chain receipt frame status; callee storage read after the trigger" };
  }, 900_000);

  it("I1: targets with no code (code hash 'changed to nothing', a getter and a predicate on an empty address): what each mempool says", async () => {
    const EMPTY: Address = "0x000000000000000000000000000000000000dEaD";
    expect(await pub.getCode({ address: EMPTY })).toBeUndefined();
    const recorded = keccak256(toHex("code that was here"));
    const cases: { key: string; spec: RuleSetSpec; verifyData: Hex }[] = [
      { key: "codeHash: changed (account is empty)", spec: rule3(codeChanged(EMPTY, recorded)), verifyData: "0x" },
      { key: "getter on an empty address inside 1-of-2 with a true sibling", spec: rule3(kOfN(1, compare(getter(EMPTY, "value()"), "ge", 0n), always(true))), verifyData: "0x" },
      { key: "predicate on an empty address inside 1-of-2 with a true sibling", spec: rule3(kOfN(1, predicate(EMPTY, { maxWitnessBytes: 4 }), always(true))), verifyData: encodeWitness([{ nodeId: 1, data: "0x01" }]) },
    ];
    const res: Record<string, unknown>[] = [];
    for (const c of cases) {
      const d = await mk(c.spec, { stakeCapable: true });
      const sim = await w.simulate(d.ruleContract, { triggerData: triggerDataFor(0), verifyData: c.verifyData });
      const row: Record<string, unknown> = { case: c.key, ruleContract: d.ruleContract, ready: sim.ethrex.valid, canonical: sim.ethrex.canonicalMempoolValid, violation: sim.ethrex.canonicalMempoolViolation, verifyGas: String(sim.ethrex.verifyGas) };
      if (sim.ethrex.valid) {
        row.publicRoute = await tryTrigger(d.ruleContract, { verifyData: c.verifyData, via: "rpc" });
        row.sidecarUnstaked = await tryTrigger(d.ruleContract, { verifyData: c.verifyData, via: "sidecar" });
      } else row.simulateText = sim.text;
      res.push(row);
    }
    out.emptyTargets = { cases: res, source: "ethrex_simulateFrameTransaction, then a real trigger through public ethrex (rpc) and through the local sidecar (unstaked)" };
  }, 900_000);

  it("external predicate: the signature context binds rule and epoch, so a witness is good once", async () => {
    const wit = toHex("sig-for-epoch-0");
    const ctxHash = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }], [0n, 0n, keccak256(triggerDataFor(0))]));
    const spec = ruleSet("independent", { when: predicate(P, { params: encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }], [keccak256(wit), ctxHash, "0x0000000000000000000000000000000000000000"]), maxWitnessBytes: 32 }), maxFires: 2 });
    const d = await mk(spec);
    const verifyData = encodeWitness([{ nodeId: 0, data: wit }]);
    expect((await noAccount.canTrigger(d.ruleContract, { triggerData: triggerDataFor(0), verifyData: encodeWitness([{ nodeId: 0, data: toHex("forged") }]) })).ready).toBe(false);
    const t = await tryTrigger(d.ruleContract, { verifyData, via: "rpc" });
    expect(t.state, JSON.stringify(t)).toBe("included");
    const again = await noAccount.canTrigger(d.ruleContract, { triggerData: triggerDataFor(0), verifyData });
    expect(again.ready).toBe(false); // epoch 1: the same witness is stale (and maxFires 2 would still allow a second fire)
    rows.push({ negative: "predicate witness replay", ruleContract: d.ruleContract, firstTrigger: t, secondTriggerReady: again.ready, secondTriggerName: again.name });
  }, 600_000);

  // ================================================================ negatives: configuration time
  it("oversize / malformed configs are rejected: by the SDK, by the publisher on chain, by the per-config logic's constructor", async () => {
    const leaf = () => always(true);
    const many = (n: number): Node[] => Array.from({ length: n }, leaf);
    const cases: Record<string, RuleSetSpec> = {
      "65 nodes": ruleSet("independent", { when: and(and(...many(16)), and(...many(16)), and(...many(16)), and(...many(12))) }),
      "depth 9": ruleSet("independent", { when: [1, 2, 3, 4, 5, 6, 7, 8].reduce<Node>((n) => not(n), leaf()) }),
      "17 children": ruleSet("independent", { when: and(...many(17)) }),
      "k > n": ruleSet("independent", { when: kOfN(3, leaf(), leaf()) }),
      "17 rules": ruleSet("independent", ...Array.from({ length: 17 }, () => ({ when: leaf() }))),
      "predicate under NOT": ruleSet("independent", { when: not(predicate(P, { maxWitnessBytes: 0 })) }),
      "predicate in an earlier else tree": ruleSet("else", { when: predicate(P, { maxWitnessBytes: 0 }) }, { when: always(true) }),
    };
    const results: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(cases)) {
      const issues = validateRuleSet(spec);
      expect(issues.length, name).toBeGreaterThan(0);
      expect(() => encodeRuleSet(spec), name).toThrow(RuleSetInvalid);
      const cfg = encodeRuleSetUnchecked(spec);
      // on chain: publisher.publish reverts (eth_call)
      let publisherRefused = false;
      try {
        await pub.simulateContract({ address: infra.publisher, abi: ruleSetPublisherAbi, functionName: "publish", args: [cfg], account: acct3.address });
      } catch {
        publisherRefused = true;
      }
      expect(publisherRefused, `${name}: the publisher must refuse`).toBe(true);
      // on chain: the per-config logic's constructor reverts (eth_call of the creation code)
      let ctorRefused = false;
      try {
        await pub.call({ account: acct3.address, data: encodeDeployData({ abi: ruleSetRuleContractAbi, bytecode: ruleSetRuleContractBytecode, args: [cfg, 0n] } as never), gas: 40_000_000n } as never);
      } catch {
        ctorRefused = true;
      }
      expect(ctorRefused, `${name}: the constructor must refuse`).toBe(true);
      results[name] = { sdkIssue: issues[0], publisherRefused, constructorRefused: ctorRefused };
    }
    // over 16 KB: 1,025-byte params
    const params = ruleSet("independent", { when: predicate(P, { params: `0x${"ab".repeat(1025)}`, maxWitnessBytes: 0 }) });
    expect(validateRuleSet(params)[0]).toMatch(/params over 1024/);
    out.oversize = { cases: results, source: "SDK validateRuleSet; publisher.publish and RuleSetContract creation code simulated with eth_call (both revert)" };
  }, 600_000);

  it("a rule contract whose verifier is not a published config pointer cannot trigger (BadPointer), and a malformed witness is refused", async () => {
    const spec = rule3(always(true));
    const plan = planRuleSet(spec, { stake: true });
    const k = await w.deployRule({ logic: infra.logic, caps: { ...plan.caps, verifier: G }, fund: FUND });
    const r = await noAccount.canTrigger(k.ruleContract, { triggerData: triggerDataFor(0) });
    expect(r.ready).toBe(false);
    const good = await mk(rule3(always(true)));
    const bad = await noAccount.canTrigger(good.ruleContract, { triggerData: triggerDataFor(0), verifyData: "0x00" });
    expect(bad.ready).toBe(false);
    rows.push({ negative: "verifier not a published pointer", ruleContract: k.ruleContract, canTrigger: { ready: r.ready, name: r.name, reason: r.reason }, malformedWitness: { ready: bad.ready, name: bad.name } });
  }, 600_000);

  it("records the staking registry and the rule contracts' stake", async () => {
    out.stakingRegistry = STAKING_REGISTRY;
    const info: RuleContractInfo = await noAccount.readRuleContract(shapeRuleContracts["and2"]!);
    out.exampleRuleContractArgs = j(info.args);
  });
});
