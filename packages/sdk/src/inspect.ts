// Inspect any frame transaction: where it went, which stage refused it, and the build's flow node by node.
// Browser-safe (fetch and viem only): the explorer on the developer site calls it directly.
//
//   const r = await inspectTransaction("0x…", { devnet: "local" });
//   r.stages  mempool admission, Core's checks, the build's flow, the chain: each passed, failed, or not reached
//   r.flow    the build's nodes (trigger, payer, conditions, operators, actions) with each node's result
//
// Where the facts come from:
//   - an included transaction: the node (eth_getTransactionByHash, the receipt). The chain proves the build's condition was
//     YES when it ran, so the nodes on the path to the first action are derived from the flow's logic (an AND that held
//     means every input held); the actions come from the receipt. Nothing is re-run on today's state.
//   - a refused or pending transaction: the sidecar's record (skandha_explorer_getTransaction keeps the frames, every
//     admission check and the failing frame with its code). The build's nodes are evaluated by its popcornExplain view
//     (or a rule set's debug view) on the current state, since the node keeps no older state.
import { createPublicClient, decodeAbiParameters, decodeFunctionResult, encodeFunctionData, getAddress, http, type Abi, type Address, type Hex } from "viem";
import { coreRule } from "@popcorn/simulator";
import { CORE_ERRORS } from "./artifacts/coreErrors.generated.ts";
import { OPEN_SPONSOR_ERRORS } from "./sponsorErrors.ts";
import { getDevnet, getReceipt, rpcRequest, type DevnetSelector } from "./transport.ts";
import { FrameMode } from "./types.ts";
import { explainRule, readRuleSet } from "./ruleset/explain.ts";
import type { Node } from "./ruleset/spec.ts";

export type NodeResult = "yes" | "no" | "unknown" | "skipped" | "not-recorded";

export interface FlowNodeView {
  index: number;
  kind: "trigger" | "payer" | "condition" | "operator" | "action";
  /** Catalog id (docs/catalog), or "" for a check of the build's own. */
  blockId: string;
  label: string;
  result: NodeResult;
  /** Indexes of the nodes that feed this one. */
  inputs: number[];
  /** Why the node has this result, when there is more to say (a Core code, a sponsor code, "derived from inclusion"). */
  note?: string;
}

export interface Flow {
  /** "explain": the build's popcornExplain view; "ruleset": a rule set's debug view; "opaque": the build explains nothing. */
  source: "explain" | "ruleset" | "opaque";
  trigger: string;
  nodes: FlowNodeView[];
  /** "inclusion": derived from the transaction having been included; "current-state": evaluated now. */
  evaluated: "inclusion" | "current-state";
}

export type StageState = "pass" | "fail" | "skipped" | "unknown";
export interface Stage {
  id: "mempool" | "core" | "payer" | "build" | "chain";
  title: string;
  state: StageState;
  detail: string;
  checks?: { rule: string; verdict: string; detail?: string }[];
}

export interface Inspection {
  hash: Hex;
  /** Where the transaction was found. */
  foundOn: "node" | "sidecar" | "nowhere";
  status: "included" | "action-reverted" | "pending" | "refused" | "unknown";
  build: Address | null;
  payer: Address | null;
  triggerData: Hex | null;
  verifyData: Hex | null;
  block: number | null;
  /** When the sidecar saw it (ms since epoch), for a transaction it holds. */
  seenAt: number | null;
  stages: Stage[];
  flow: Flow | null;
  /** The refusal, when there is one: the frame that refused, its code and what the code means. */
  /** The refusal: the frame that reverted with its code ("build" or "payer"), or a mempool rule that refused it before any
   *  frame decided ("mempool": structure, storage access, gas budget, ...; frame is -1 when none is named). */
  refusal: { frame: number; code: number | null; who: "build" | "payer" | "mempool" | "other"; meaning: string; rule?: string } | null;
}

interface RawFrame {
  mode: number;
  flags: number;
  target: Address | null;
  data: Hex;
}

const POP_SELECTOR = "0xd9292504";
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(BigInt(v)) : 0);

function normFrames(frames: unknown[]): RawFrame[] {
  return frames.map((f) => {
    const x = f as Record<string, unknown>;
    const t = (x.target ?? x.to ?? null) as string | null;
    return { mode: num(x.mode), flags: num(x.flags), target: t ? getAddress(t) : null, data: ((x.data as string) ?? "0x") as Hex };
  });
}

/** The trigger data and verify data a frame transaction carried, and its payer if a separate account paid. */
export function triggerOf(sender: Address, frames: RawFrame[]): { triggerData: Hex | null; verifyData: Hex | null; payer: Address | null } {
  const isSender = (t: Address | null) => t === null || getAddress(t) === getAddress(sender);
  const verify = frames.find((f) => f.mode === FrameMode.VERIFY && isSender(f.target));
  const payerFrame = frames.find((f) => f.mode === FrameMode.VERIFY && !isSender(f.target));
  const senderFrame = frames.find((f) => f.mode === FrameMode.SENDER);
  let triggerData: Hex | null = null;
  if (senderFrame) {
    const d = senderFrame.data.toLowerCase();
    if (d.startsWith(POP_SELECTOR)) {
      try {
        triggerData = decodeAbiParameters([{ type: "bytes" }], `0x${d.slice(10)}` as Hex)[0] as Hex;
      } catch {
        triggerData = null;
      }
    }
  }
  return { triggerData, verifyData: verify?.data ?? null, payer: payerFrame?.target ?? null };
}

// ---------------------------------------------------------------- the build's flow

const explainAbi = [
  {
    type: "function",
    name: "popcornExplain",
    stateMutability: "view",
    inputs: [{ type: "bytes" }, { type: "bytes" }],
    outputs: [
      { name: "trigger", type: "string" },
      { name: "flow", type: "string" },
      { name: "results", type: "bytes" },
    ],
  },
] as const satisfies Abi;

const KINDS: Record<string, FlowNodeView["kind"]> = { t: "trigger", p: "payer", c: "condition", o: "operator", a: "action" };

/** A build's compact flow ("kind|blockId|label|inputs" nodes separated by ';', contracts/src/rules/Explain.sol) and its
 *  one-byte-per-node results, as nodes. */
export function parseFlow(flow: string, results: Hex): FlowNodeView[] {
  const res = results.length > 2 ? (results.slice(2).match(/../g) as string[]).map((x) => parseInt(x, 16)) : [];
  return flow.split(";").map((part, index) => {
    const [k = "", blockId = "", label = "", inputs = ""] = part.split("|");
    return { index, kind: KINDS[k] ?? (k as FlowNodeView["kind"]), blockId, label, result: RESULT[res[index] ?? 2] ?? "unknown", inputs: inputs ? inputs.split(",").map(Number) : [] };
  });
}

const RESULT: NodeResult[] = ["no", "yes", "unknown", "skipped"];

/** The build's flow for a trigger, evaluated on the current state: its popcornExplain view, else a rule set's debug view,
 *  else one opaque condition node. */
export async function explainTrigger(build: Address, triggerData: Hex, verifyData: Hex, o: { devnet?: DevnetSelector; rpcUrl?: string } = {}): Promise<Flow> {
  const url = o.rpcUrl ?? getDevnet(o.devnet ?? "local").rpcUrl;
  const client = createPublicClient({ transport: http(url) });
  try {
    const data = encodeFunctionData({ abi: explainAbi, functionName: "popcornExplain", args: [triggerData, verifyData] });
    const ret = await client.call({ to: getAddress(build), data });
    if (ret.data && ret.data !== "0x") {
      const [trigger, flow, results] = decodeFunctionResult({ abi: explainAbi, functionName: "popcornExplain", data: ret.data });
      return { source: "explain", trigger, evaluated: "current-state", nodes: parseFlow(flow, results) };
    }
  } catch {
    // no explain view, or it reverted on this data: try a rule set, then fall back
  }
  try {
    return await ruleSetFlow(client, build, triggerData, verifyData);
  } catch {
    return opaqueFlow();
  }
}

function opaqueFlow(): Flow {
  return {
    source: "opaque",
    trigger: "trigger",
    evaluated: "current-state",
    nodes: [
      { index: 0, kind: "trigger", blockId: "", label: "trigger", result: "yes", inputs: [] },
      { index: 1, kind: "condition", blockId: "", label: "the build's condition (this build has no explain view, so its parts cannot be shown)", result: "unknown", inputs: [0] },
      { index: 2, kind: "action", blockId: "", label: "the build's action", result: "skipped", inputs: [1] },
    ],
  };
}

const RULESET_BLOCK: Record<Node["type"], string> = {
  and: "and", or: "or", not: "not", kofn: "k-of-n", exactly: "exactly-one",
  cmp: "compare", range: "compare", ratio: "compare", crossing: "compare", delta: "percent-change", codeHash: "code-hash-changed", predicate: "signature", const: "",
};
const RULESET_RESULT: Record<string, NodeResult> = { true: "yes", false: "no", unknown: "unknown", "not evaluated": "skipped" };

async function ruleSetFlow(client: ReturnType<typeof createPublicClient>, build: Address, triggerData: Hex, verifyData: Hex): Promise<Flow> {
  const ctx = { publicClient: client } as never;
  const { spec } = await readRuleSet(ctx, build);
  const ruleId = triggerData.length >= 66 ? Number(BigInt(`0x${triggerData.slice(2, 66)}`)) : 0;
  const ex = await explainRule(ctx, build, { ruleId, spec, triggerData, verifyData });
  const rule = spec.rules[ruleId];
  const nodes: FlowNodeView[] = [{ index: 0, kind: "trigger", blockId: "", label: `rule ${ruleId}${rule?.name ? ` (${rule.name})` : ""}`, result: ex.ruleExists ? "yes" : "no", inputs: [] }];
  nodes.push({ index: 1, kind: "payer", blockId: "self-paying", label: "the build pays the gas", result: "yes", inputs: [0] });
  // the debug view lists the tree in preorder with depths; emit it children-first so every input is an earlier node
  const pre = ex.nodes;
  const childrenOf = (i: number) => {
    const out: number[] = [];
    for (let j = i + 1; j < pre.length && pre[j]!.depth > pre[i]!.depth; j++) if (pre[j]!.depth === pre[i]!.depth + 1) out.push(j);
    return out;
  };
  const emitted = new Map<number, number>();
  const emit = (i: number): number => {
    const kids = childrenOf(i).map(emit);
    const n = pre[i]!;
    const composite = ["and", "or", "not", "kofn", "exactly"].includes(n.type);
    const index = nodes.length;
    nodes.push({ index, kind: composite ? "operator" : "condition", blockId: RULESET_BLOCK[n.type as Node["type"]] ?? "", label: n.label, result: RULESET_RESULT[n.result] ?? "unknown", inputs: composite ? kids : [0] });
    emitted.set(i, index);
    return index;
  };
  let root = pre.length ? emit(0) : -1;
  if (ex.earlier.length) {
    // an else rule fires only when every earlier rule's tree is definitely false
    const ins: number[] = [];
    for (const e of ex.earlier) {
      ins.push(nodes.length);
      nodes.push({ index: nodes.length, kind: "condition", blockId: "if-else", label: `earlier rule ${e.ruleId} is definitely false`, result: e.result === "false" ? "yes" : e.result === "not evaluated" ? "skipped" : "no", inputs: [0] });
    }
    if (root >= 0) ins.push(root);
    root = nodes.length;
    nodes.push({ index: root, kind: "operator", blockId: "if-else", label: "IF / ELSE: this rule, only if every earlier one is false", result: ex.wouldPass ? "yes" : "no", inputs: ins });
  }
  const a = rule?.action ?? { type: "none" as const };
  const isPause = a.type === "call" && (a.data ?? "0x").toLowerCase().startsWith("0x8456cb59");
  nodes.push({
    index: nodes.length,
    kind: "action",
    blockId: a.type === "call" ? (isPause ? "pause" : "call") : "",
    label: a.type === "call" ? `${isPause ? "pause" : "call"} ${a.target}` : "record that the rule fired",
    result: ex.wouldPass ? "yes" : "skipped",
    inputs: root >= 0 ? [root] : [0],
  });
  if (ex.exhausted) Object.assign(nodes[0]!, { result: "no" as NodeResult, note: "this rule has fired its maximum number of times: it is closed" });
  if (!ex.ruleExists) Object.assign(nodes[0]!, { result: "no" as NodeResult, note: `this build has no rule ${ruleId}` });
  if (ex.ruleExists && !ex.witnessOk) nodes[0]!.note = "the verify data (witness) is malformed: entries must be ascending, in bounds, nothing trailing";
  const top = pre[0]?.result;
  if (ex.ruleExists && ex.witnessOk && !ex.wouldPass && top === "true" && !ex.exhausted && ex.earlier.every((e) => e.result === "false")) {
    // every node holds, yet the rule says no: an OR was handed the wrong child
    for (const n of nodes) if (n.kind === "operator" && n.blockId === "or") Object.assign(n, { result: "no" as NodeResult, note: "the trigger named an OR input that is not true (the hint in the verify data); its other input holds, so a trigger naming that one would pass" });
  }
  return { source: "ruleset", trigger: `rule ${ruleId}`, evaluated: "current-state", nodes };
}

/** For an included transaction: the condition was YES when it ran. Nodes on the path to the first action are derived from
 *  the flow's logic, actions from the receipt; nodes the logic cannot settle are "not-recorded". */
export function deriveFromInclusion(flow: Flow, actionsOk: boolean): Flow {
  const nodes = flow.nodes.map((n) => ({ ...n, result: "not-recorded" as NodeResult, note: undefined as string | undefined }));
  const set = (i: number, r: NodeResult) => {
    const n = nodes[i];
    if (!n || n.result === r) return;
    n.result = r;
    n.note = "derived: the transaction was included, so this held when it ran";
    if (r !== "yes" || n.kind === "trigger") return;
    if (n.kind === "operator" && (n.blockId === "and" || n.blockId === "if-else" || n.blockId === "")) n.inputs.forEach((j) => set(j, "yes"));
    else if (n.kind === "operator" && (n.blockId === "not")) n.inputs.forEach((j) => set(j, "no"));
    else if (n.kind !== "operator") n.inputs.forEach((j) => set(j, "yes"));
    // OR, K-of-N, EXACTLY ONE: some of the inputs held; which ones is not recorded on chain
  };
  const firstAction = nodes.findIndex((n) => n.kind === "action");
  nodes.forEach((n) => {
    if (n.kind === "trigger" || n.kind === "payer") n.result = "yes";
  });
  if (firstAction >= 0) {
    nodes[firstAction]!.inputs.forEach((j) => set(j, "yes"));
    // actions chained after the first one ran with it; conditions after an action are not recorded on chain
    const ran = new Set<number>([firstAction]);
    for (let i = firstAction; i < nodes.length; i++) {
      const n = nodes[i]!;
      if (n.kind === "action" && (i === firstAction || n.inputs.every((j) => ran.has(j)))) {
        ran.add(i);
        n.result = actionsOk ? "yes" : "no";
        n.note = actionsOk ? "ran: the action frame succeeded" : "the action frame reverted";
      }
    }
  }
  return { ...flow, nodes, evaluated: "inclusion" };
}

// ---------------------------------------------------------------- the whole transaction

interface SidecarRecord {
  entry: { status?: string; submittedTime?: number; tx?: { frames?: unknown[]; sender?: string } } | null;
  admission: { at?: number; outcome?: string; sender?: string; frames?: unknown[]; checks?: { rule: string; verdict: string; detail?: string }[]; errorCode?: number } | null;
  events?: { kind?: string; reason?: string }[];
}

/** "validation frame 1: reverted with data 0x…6d" -> { frame: 1, code: 0x6d } */
export function parseRefusal(detail: string | undefined): { frame: number; code: number | null } | null {
  const frame = detail ? /frame (\d+)/i.exec(detail) : null;
  if (!frame) return null;
  const word = /0x([0-9a-f]+)\s*$/i.exec(detail!)?.[1];
  return { frame: Number(frame[1]), code: word ? Number(BigInt(`0x${word}`) & 0xffffn) : null };
}

/** A Core code in plain English: the simulator's sentence and fix, else the layout table's name. */
export function coreMeaning(code: number): string {
  const r = coreRule(code);
  if (r) return `Core 0x${code.toString(16)} (${r.title.toLowerCase()}): ${r.sentence.replace(/^Core 0x[0-9a-f]+:\s*/i, "")} ${r.fix}`;
  const e = CORE_ERRORS[code];
  return e ? `Core 0x${code.toString(16)} ${e.name}: ${e.check}` : `code 0x${code.toString(16)}`;
}

export async function inspectTransaction(hash: Hex, o: { devnet?: DevnetSelector } = {}): Promise<Inspection> {
  const devnet = getDevnet(o.devnet ?? "local");
  const out: Inspection = { hash, foundOn: "nowhere", status: "unknown", build: null, payer: null, triggerData: null, verifyData: null, block: null, seenAt: null, stages: [], flow: null, refusal: null };

  const onNode = await rpcRequest<Record<string, unknown> | null>(devnet.rpcUrl, "eth_getTransactionByHash", [hash]).catch(() => null);
  let side: SidecarRecord | null = null;
  try {
    side = await rpcRequest<SidecarRecord | null>(devnet.sidecarUrl, "skandha_explorer_getTransaction", [hash]);
  } catch {
    side = null;
  }

  let frames: RawFrame[] = [];
  if (onNode) {
    out.foundOn = "node";
    out.build = getAddress((onNode.sender ?? onNode.from) as string);
    frames = normFrames((onNode.frames as unknown[]) ?? []);
    out.block = onNode.blockNumber ? num(onNode.blockNumber) : null;
  } else if (side && (side.admission || side.entry)) {
    out.foundOn = "sidecar";
    const s = side.admission?.sender ?? side.entry?.tx?.sender;
    out.build = s ? getAddress(s) : null;
    frames = normFrames((side.admission?.frames ?? side.entry?.tx?.frames ?? []) as unknown[]);
  } else {
    out.stages.push({ id: "mempool", title: "Not found", state: "unknown", detail: `neither the node nor the sidecar at ${devnet.sidecarUrl} knows this hash (a sidecar keeps refusals only in memory)` });
    return out;
  }
  out.seenAt = side?.admission?.at ?? side?.entry?.submittedTime ?? null;
  if (!out.build) return out;
  const t = triggerOf(out.build, frames);
  Object.assign(out, t);

  // mempool admission
  const adm = side?.admission;
  if (adm) {
    const failed = adm.checks?.find((c) => c.verdict === "fail");
    out.stages.push({
      id: "mempool",
      title: "Alternative mempool admission",
      state: adm.outcome === "rejected" ? "fail" : "pass",
      detail: adm.outcome === "rejected" ? `refused: ${failed ? `${failed.rule}: ${failed.detail ?? ""}` : (side?.events?.find((e) => e.kind === "rejected")?.reason ?? "rejected")}` : `admitted (${adm.outcome})`,
      ...(adm.checks ? { checks: adm.checks } : {}),
    });
    if (adm.outcome === "rejected") {
      const reason = failed?.detail ?? side?.events?.find((e) => e.kind === "rejected")?.reason ?? "";
      // a frame's VERIFY reverted with a word: Core's code (the build) or the payer's code. Anything else is a mempool rule.
      const r = failed?.rule === "simulation" && /validation frame \d+: reverted with data 0x[0-9a-f]+\s*$/i.test(reason) ? parseRefusal(reason) : null;
      if (!r) out.refusal = { frame: parseRefusal(reason)?.frame ?? -1, code: null, who: "mempool", rule: failed?.rule ?? "rejected", meaning: `the alternative mempool's ${failed?.rule ?? ""} rule refused it: ${reason}` };
      if (r) {
        const target = frames[r.frame]?.target;
        const who: "build" | "payer" | "other" = frames[r.frame]?.mode === FrameMode.VERIFY ? (!target || getAddress(target) === out.build ? "build" : "payer") : "other";
        const meaning =
          r.code === null
            ? "reverted"
            : who === "payer"
              ? (OPEN_SPONSOR_ERRORS[r.code] ?? `the payer refused with code 0x${r.code.toString(16)}`)
              : coreMeaning(r.code);
        out.refusal = { frame: r.frame, code: r.code, who, meaning };
      }
    }
  } else if (out.foundOn === "node") {
    out.stages.push({ id: "mempool", title: "Mempool admission", state: "pass", detail: "admitted (this sidecar holds no record: it was admitted elsewhere, or the record has expired)" });
  }

  // Core, payer, build, chain
  const receipt = out.foundOn === "node" ? await getReceipt(hash, { devnet: o.devnet ?? "local" }).catch(() => null) : null;
  const ref = out.refusal;
  if (receipt) {
    out.payer = out.payer ?? (receipt.payer && receipt.payer !== out.build ? receipt.payer : null);
    out.status = receipt.status === "success" ? "included" : "action-reverted";
    out.stages.push({ id: "core", title: "Core checks", state: "pass", detail: "frame layout, fee caps, gas floor, nonce key: all passed (it was included)" });
    if (out.payer) out.stages.push({ id: "payer", title: "Payer", state: "pass", detail: `${out.payer} approved and paid` });
    out.stages.push({ id: "build", title: "The build's condition", state: "pass", detail: "YES when it ran: the build approved the transaction" });
    out.stages.push({ id: "chain", title: "Included", state: receipt.status === "success" ? "pass" : "fail", detail: `block ${receipt.blockNumber}, ${receipt.gasUsed} gas, ${receipt.status === "success" ? "every frame succeeded" : "a frame reverted"}` });
  } else if (out.foundOn === "sidecar" && ref?.who === "mempool") {
    out.status = "refused";
    out.stages.push({ id: "core", title: "Core checks", state: "skipped", detail: `not run: the mempool's ${ref.rule} rule refused the transaction first` });
    out.stages.push({ id: "build", title: "The build's condition", state: "skipped", detail: "not reached" });
    out.stages.push({ id: "chain", title: "Included", state: "skipped", detail: "never included: a refused transaction costs nothing" });
  } else if (out.foundOn === "sidecar") {
    out.status = adm?.outcome === "rejected" ? "refused" : "pending";
    const buildRefused = ref?.who === "build";
    const conditionNo = buildRefused && ref?.code === 0x22;
    out.stages.push({
      id: "core",
      title: "Core checks",
      state: !ref ? "unknown" : buildRefused && !conditionNo ? "fail" : "pass",
      detail: !ref ? "not yet decided" : buildRefused && !conditionNo ? `refused: ${ref.meaning}` : "frame layout, fee caps, gas floor, nonce key: passed",
    });
    if (out.payer) out.stages.push({ id: "payer", title: "Payer", state: ref?.who === "payer" ? "fail" : ref ? "pass" : "unknown", detail: ref?.who === "payer" ? `refused: ${ref.meaning}` : `${out.payer}` });
    out.stages.push({
      id: "build",
      title: "The build's condition",
      state: conditionNo ? "fail" : buildRefused || ref?.who === "payer" ? "skipped" : ref ? "pass" : "unknown",
      detail: conditionNo ? "NO: see the flow for the node that said no" : buildRefused ? "not reached: Core refused first" : ref?.who === "payer" ? "passed; the payer refused afterwards" : "",
    });
    out.stages.push({ id: "chain", title: "Included", state: "skipped", detail: out.status === "refused" ? "never included: a refused transaction costs nothing" : "waiting" });
  }

  // the build's flow
  if (out.triggerData !== null) {
    const flow = await explainTrigger(out.build, out.triggerData, out.verifyData ?? "0x", { rpcUrl: devnet.rpcUrl });
    if (receipt) {
      const senderIdx = frames.findIndex((f) => f.mode === FrameMode.SENDER);
      const actionFrame = receipt.frameReceipts[senderIdx];
      out.flow = deriveFromInclusion(flow, actionFrame ? actionFrame.status === "success" : receipt.status === "success");
    }
    else if (ref && (ref.who === "mempool" || (ref.who === "build" && ref.code !== 0x22))) {
      // Core refused before the condition ran: every build node is grey
      out.flow = { ...flow, nodes: flow.nodes.map((n) => ({ ...n, result: n.kind === "trigger" ? "yes" : "skipped", note: n.kind === "trigger" ? undefined : `not reached: ${ref.meaning}` })) };
    } else if (ref && ref.who === "payer") {
      out.flow = {
        ...flow,
        nodes: flow.nodes.map((n) =>
          n.kind === "payer" ? { ...n, result: "no" as NodeResult, note: `${out.payer} refused: ${ref.meaning}` } : n.kind === "action" ? { ...n, result: "skipped" as NodeResult, note: "not reached: the payer refused" } : n,
        ),
      };
    } else out.flow = flow;
  }
  return out;
}
