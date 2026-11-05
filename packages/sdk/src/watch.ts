// watch(): follow a frame tx from submission to inclusion.
//
// Sources, polled every interval:
// - the ethrex node: eth_getTransactionReceipt (inclusion) and eth_getTransactionByHash
//   (pending in the node's own mempool);
// - mempools (gateway and/or local sidecar): skandha_explorer_getTransaction, falling back
//   to skandha_frameTransactionStatus (transport.getAdmissionStatus).
//
// Every source is queried independently each poll. A source that fails (HTTP 5xx, 429,
// timeout, JSON-RPC error such as a rate limit) is *unknown* for that poll: it is listed in
// `unavailable` / `errors` and polling continues until the deadline. "Not there" is only
// concluded from sources that actually answered: a tx is reported dropped only when every
// configured source answered and none holds it.
import type { Hex } from "viem";
import { WatchTimeout } from "./errors.ts";
import {
  getAdmissionStatus,
  getDevnet,
  getNodeTxState,
  getReceipt,
  type AdmissionStatus,
  type DevnetSelector,
  type FrameTxReceipt,
  type TransportOptions,
} from "./transport.ts";

export type MempoolSource = "gateway" | "sidecar";
/** A source that did not answer this poll. "node" = the ethrex node. */
export type UnavailableSource = MempoolSource | "node";

export type WatchStatus =
  | { state: "waiting"; unavailable: UnavailableSource[] }
  | { state: "admitted"; by: (MempoolSource | "node")[]; unavailable: UnavailableSource[] }
  | { state: "included"; blockNumber: bigint; status: "success" | "reverted"; gasUsed: bigint; receipt: FrameTxReceipt }
  | { state: "dropped"; reason: string; by: MempoolSource | "node" };

export type FinalWatchStatus = Extract<WatchStatus, { state: "included" | "dropped" }>;

export interface WatchOptions extends Pick<TransportOptions, "fetch" | "headers"> {
  devnet?: DevnetSelector;
  /** Mempools to ask for admission. Default `["gateway"]`. */
  mempools?: MempoolSource[];
  /** Poll interval, default 2000 ms. */
  intervalMs?: number;
  /** Overall deadline, default 180000 ms; throws WatchTimeout when it passes (requests are cut off at it). */
  timeoutMs?: number;
  /** Per-request timeout, default 15000 ms (always capped by the remaining time). */
  requestTimeoutMs?: number;
  /**
   * Polls in a row where every configured source answered and none holds the tx, after it
   * was seen somewhere, before it is reported `dropped`. Default 5.
   */
  missingPollsBeforeDropped?: number;
  /** Called on every status change (the same values the generator yields). */
  onStatus?: (s: WatchStatus) => void;
  /** Called for every failed source request (they never abort the watch). */
  onError?: (e: SourceError) => void;
  signal?: AbortSignal;
}

export interface SourceError {
  source: "receipt" | "node" | MempoolSource;
  error: unknown;
}

export interface PollResult {
  /** undefined = the receipt lookup failed this poll */
  receipt: FrameTxReceipt | null | undefined;
  /** undefined = the tx lookup failed this poll */
  node: "pending" | "mined" | null | undefined;
  mempools: Partial<Record<MempoolSource, AdmissionStatus>>;
  unavailable: UnavailableSource[];
  errors: SourceError[];
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function key(s: WatchStatus): string {
  if (s.state === "admitted") return `admitted:${s.by.join(",")}:${s.unavailable.join(",")}`;
  if (s.state === "waiting") return `waiting:${s.unavailable.join(",")}`;
  return s.state;
}

async function settle<T>(source: SourceError["source"], p: Promise<T>, errors: SourceError[], signal?: AbortSignal): Promise<T | undefined> {
  try {
    return await p;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    errors.push({ source, error });
    return undefined;
  }
}

/** One poll of every source. Failed sources come back as undefined / in `unavailable`; it only throws if `signal` aborts. */
export async function pollStatus(
  hash: Hex,
  opts: Pick<WatchOptions, "devnet" | "mempools" | "fetch" | "headers" | "signal"> & { timeoutMs?: number } = {},
): Promise<PollResult> {
  const c = getDevnet(opts.devnet);
  const mempools = opts.mempools ?? ["gateway"];
  const req: TransportOptions = { devnet: c, timeoutMs: opts.timeoutMs ?? 15_000 };
  if (opts.signal) req.signal = opts.signal;
  if (opts.fetch) req.fetch = opts.fetch;
  if (opts.headers) req.headers = opts.headers;
  const errors: SourceError[] = [];
  const [receipt, node, ...adm] = await Promise.all([
    settle("receipt", getReceipt(hash, req), errors, opts.signal),
    settle("node", getNodeTxState(hash, req), errors, opts.signal),
    ...mempools.map((m) => {
      const { devnet: _d, ...rest } = req;
      return settle(m, getAdmissionStatus(hash, m === "gateway" ? c.gatewayUrl : c.sidecarUrl, { ...rest, isGateway: m === "gateway" }), errors, opts.signal);
    }),
  ]);
  const out: Partial<Record<MempoolSource, AdmissionStatus>> = {};
  const unavailable: UnavailableSource[] = [];
  if (receipt === undefined || node === undefined) unavailable.push("node");
  mempools.forEach((m, i) => {
    const a = adm[i];
    if (a) out[m] = a;
    else unavailable.push(m);
  });
  return { receipt, node, mempools: out, unavailable, errors };
}

/** Yields each status change until `included` or `dropped` (then returns). Throws WatchTimeout at the deadline. */
export async function* watchStatuses(hash: Hex, opts: WatchOptions = {}): AsyncGenerator<WatchStatus, FinalWatchStatus> {
  const interval = opts.intervalMs ?? 2_000;
  const timeout = opts.timeoutMs ?? 180_000;
  const perRequest = opts.requestTimeoutMs ?? 15_000;
  const missingLimit = opts.missingPollsBeforeDropped ?? 5;
  const deadline = Date.now() + timeout;
  let lastKey = "";
  let last: WatchStatus = { state: "waiting", unavailable: [] };
  let seen = false;
  let missing = 0;

  const emit = function* (s: WatchStatus) {
    last = s;
    const k = key(s);
    if (k !== lastKey) {
      lastKey = k;
      opts.onStatus?.(s);
      yield s;
    }
  };
  const remaining = () => deadline - Date.now();

  for (;;) {
    opts.signal?.throwIfAborted();
    if (remaining() <= 0) throw new WatchTimeout(hash, last, timeout);
    // cut every request off at the deadline
    const deadlineSignal = AbortSignal.timeout(Math.max(1, remaining()));
    const p = await pollStatus(hash, {
      ...opts,
      timeoutMs: Math.max(1, Math.min(perRequest, remaining())),
      signal: opts.signal ? AbortSignal.any([opts.signal, deadlineSignal]) : deadlineSignal,
    }).catch((e) => {
      if (opts.signal?.aborted) throw opts.signal.reason;
      if (deadlineSignal.aborted) throw new WatchTimeout(hash, last, timeout);
      throw e;
    });
    for (const e of p.errors) opts.onError?.(e);

    if (p.receipt) {
      const s: FinalWatchStatus = { state: "included", blockNumber: p.receipt.blockNumber, status: p.receipt.status, gasUsed: p.receipt.gasUsed, receipt: p.receipt };
      yield* emit(s);
      return s;
    }
    const by: (MempoolSource | "node")[] = [];
    let mempoolDrop: { reason: string; by: MempoolSource } | null = null;
    for (const [m, a] of Object.entries(p.mempools) as [MempoolSource, AdmissionStatus][]) {
      if (!a.known) continue;
      if (a.outcome === "accepted" || a.outcome === "included") by.push(m);
      else mempoolDrop ??= { reason: `${a.outcome}${a.reason ? `: ${a.reason}` : ""}`, by: m };
    }
    if (p.node === "pending" || p.node === "mined") by.unshift("node");
    // only answers count as absence; an unavailable source might still hold the tx
    const allAnswered = p.unavailable.length === 0;

    if (by.length > 0) {
      seen = true;
      missing = 0;
      yield* emit({ state: "admitted", by, unavailable: p.unavailable });
    } else if (mempoolDrop && allAnswered) {
      // a mempool rejected/dropped it and every other source answered without it
      const s: FinalWatchStatus = { state: "dropped", ...mempoolDrop };
      yield* emit(s);
      return s;
    } else if (seen) {
      if (allAnswered && ++missing >= missingLimit) {
        const s: FinalWatchStatus = { state: "dropped", reason: `no longer pending anywhere for ${missing} polls and not included`, by: "node" };
        yield* emit(s);
        return s;
      }
    } else {
      yield* emit({ state: "waiting", unavailable: p.unavailable });
    }

    if (remaining() <= 0) throw new WatchTimeout(hash, last, timeout);
    await sleep(Math.min(interval, remaining()), opts.signal);
  }
}

/** Resolves with the final status (`included` or `dropped`). Throws WatchTimeout. */
export async function watch(hash: Hex, opts: WatchOptions = {}): Promise<FinalWatchStatus> {
  const it = watchStatuses(hash, opts);
  for (;;) {
    const r = await it.next();
    if (r.done) return r.value;
  }
}
