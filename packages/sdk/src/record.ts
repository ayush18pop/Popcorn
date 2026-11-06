// The recorder: runs a trigger on a devnet and writes what happened in the site's run format (examples/<group>/<id>/run.json):
// the frames as built, what validation used (ethrex simulation), what the mempool said, the receipt, and the world before
// and after. A failing case is recorded from a real refused simulation, never invented.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Address, Hex, PublicClient } from "viem";
import type { CanTriggerResult, TriggerOptions } from "./actions.ts";
import { readStakeStatus } from "./stakeStatus.ts";
import { explainTrigger, inspectTransaction, triggerOf, type Flow } from "./inspect.ts";
import { sendFrameTransaction, type DevnetSelector } from "./transport.ts";
import type { FrameTx } from "./types.ts";

type Trig = TriggerOptions & { triggerData?: Hex; verifyData?: Hex };
interface Client {
  canTrigger: (k: Address, o?: Trig) => Promise<CanTriggerResult>;
  trigger: (k: Address, o?: Trig) => Promise<Hex>;
  watch: (h: Hex) => Promise<{ state: string }>;
}

const MODE = ["DEFAULT", "VERIFY", "SENDER"] as const;
const short = (d: Hex) => (d.length > 26 ? `${d.slice(0, 10)}…(${(d.length - 2) / 2} bytes)` : d);

export interface WorldReader {
  (): Promise<Record<string, string>>;
}

export interface RecordedStory {
  module: string;
  role: string;
  title: string;
  tx: Hex;
  block: number;
  gasUsed: number;
  status: string;
  /** The build's flow for this transaction (frame transactions only). */
  flow?: Flow;
}

function frames(tx: FrameTx, labels: Record<string, string>, explain: string[] = []) {
  return tx.frames.map((f, i) => ({
    mode: MODE[f.mode] ?? String(f.mode),
    flags: f.flags,
    target: f.target === null ? labels.sender ?? "sender" : labels[f.target.toLowerCase()] ?? f.target,
    gasLimit: Number(f.gasLimit),
    data: short(f.data),
    ...(explain[i] ? { explain: explain[i] } : {}),
  }));
}

/** Records one trigger end to end. Throws if it is not included: a recorded run is a run that happened. */
export async function recordTrigger(o: {
  client: Client;
  pub: PublicClient;
  devnet: string;
  ruleContract: Address;
  trigger: Trig;
  labels: Record<string, string>;
  explain?: string[];
  world: WorldReader;
  reads?: { label: string; value: string; gas: number }[];
  mempool?: string;
}) {
  const before = await o.world();
  const ready = await o.client.canTrigger(o.ruleContract, o.trigger);
  if (!ready.ready) throw new Error(`not ready: ${ready.name} ${ready.reason}`);
  const stake = await readStakeStatus(o.pub, o.devnet, o.ruleContract);
  const verifyUsed = Number(ready.simulation.frames?.[0]?.gasUsed ?? 0n);
  // a relay can give up on a valid transaction; resend at most twice, only while it still simulates as valid
  let hash: Hex = await o.client.trigger(o.ruleContract, o.trigger);
  for (let attempt = 0; ; attempt++) {
    const st = await o.client.watch(hash);
    if (st.state === "included") break;
    if (attempt >= 2 || !(await o.client.canTrigger(o.ruleContract, o.trigger)).ready) throw new Error(`trigger ${hash}: ${st.state}`);
    hash = await o.client.trigger(o.ruleContract, o.trigger);
  }
  const r = await o.pub.getTransactionReceipt({ hash });
  const after = await o.world();
  const steps = [
    { stage: "build", frames: frames(ready.tx, o.labels, o.explain), world: before },
    { stage: "validate", reads: o.reads ?? [{ label: "validation (frame 0)", value: ready.name, gas: verifyUsed }], result: ready.name, gasUsed: verifyUsed },
    {
      stage: "admit",
      report: {
        mempool: o.mempool ?? "alternative mempool (ERC-8421 sidecar)",
        outcome: "accepted",
        entity: { name: o.labels[o.ruleContract.toLowerCase()] ?? "rule contract", staked: Boolean(stake?.isStaked), budget: stake?.isStaked ? 2_500_000 : 250_000, used: Number(ready.verifyGasLimit) },
        checks: [
          { rule: "CORE", verdict: "pass", detail: "Core's checks passed and the rule's condition returned true" },
          { rule: "CANONICAL", verdict: ready.canonical ? "pass" : "warn", detail: ready.canonical ? "the node's own mempool rules pass too" : `the node's own mempool would refuse it: ${ready.simulation.canonicalMempoolViolation ?? "reads outside the sender"}` },
        ],
      },
    },
    { stage: "include", tx: hash, block: Number(r.blockNumber), status: r.status, payer: ready.simulation.payer ? o.labels[ready.simulation.payer.toLowerCase()] ?? ready.simulation.payer : "rule contract", gasUsed: Number(r.gasUsed) },
    { stage: "act", before, after, events: r.logs.map((l) => `${o.labels[l.address.toLowerCase()] ?? l.address}: ${l.topics[0]?.slice(0, 10)}`) },
  ];
  // the build's flow for this transaction, exactly as the explorer shows it for this hash
  const flow = (await inspectTransaction(hash, { devnet: o.devnet as DevnetSelector })).flow;
  return { hash, receipt: r, steps, ready, flow };
}

/** Records a refusal from a real simulation, with the build's flow evaluated at that moment. With `submit` (default true) the
 *  refused transaction is also sent to the sidecar, which refuses it (it costs nothing) and keeps it under its hash, so the
 *  explorer can show the same refusal for that hash. */
export async function recordRefusal(o: { client: Client; ruleContract: Address; trigger: Trig; labels: Record<string, string>; explain?: string[]; world: WorldReader; mempool?: string; devnet?: DevnetSelector; submit?: boolean }) {
  const world = await o.world();
  const r = await o.client.canTrigger(o.ruleContract, o.trigger);
  if (r.ready) throw new Error("expected a refusal, but the trigger is valid");
  const t = triggerOf(o.ruleContract, r.tx.frames.map((f) => ({ mode: f.mode, flags: f.flags, target: f.target, data: f.data })));
  const flow: Flow = await explainTrigger(o.ruleContract, t.triggerData ?? "0x", t.verifyData ?? "0x", { devnet: o.devnet ?? "local" });
  let tx: Hex | null = null;
  if (o.submit !== false) {
    try {
      await sendFrameTransaction(r.raw, { devnet: o.devnet ?? "local", via: "sidecar" });
    } catch {
      // refused, as expected: the sidecar keeps the refusal under the transaction's hash
    }
    tx = r.hash;
  }
  const used = Number(r.simulation.frames?.find((f) => !f.succeeded)?.gasUsed ?? r.simulation.frames?.[0]?.gasUsed ?? 0n);
  return {
    result: r.name,
    ...(r.code !== null ? { core: `0x${r.code.toString(16)}` } : {}),
    ...(tx ? { tx } : {}),
    flow,
    steps: [
      { stage: "build", frames: frames(r.tx, o.labels, o.explain), world },
      { stage: "validate", reads: [{ label: `frame ${r.simulation.failedFrameIndex ?? 0}`, value: r.reason, gas: used }], result: r.name, gasUsed: used },
      { stage: "admit", report: { mempool: o.mempool ?? "alternative mempool (ERC-8421 sidecar)", outcome: "rejected", checks: [{ rule: r.code !== null ? `0x${r.code.toString(16)}` : r.name, verdict: "fail", detail: r.reason }] } },
    ],
  };
}

export async function storyEntry(pub: PublicClient, hash: Hex, module: string, role: string, title: string, devnet: DevnetSelector = "local"): Promise<RecordedStory> {
  const r = await pub.getTransactionReceipt({ hash });
  // a frame transaction gets its flow (the build's nodes); an ordinary call (a deposit, a setup) has none
  const flow = (await inspectTransaction(hash, { devnet }).catch(() => null))?.flow ?? null;
  return { module, role, title, tx: hash, block: Number(r.blockNumber), gasUsed: Number(r.gasUsed), status: r.status, ...(flow ? { flow } : {}) };
}

/** Writes a recorded run (recorded: true) for the site's player and the example page. */
export function writeRun(path: string, run: Record<string, unknown>) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ recorded: true, ...run }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
}
