// JSON-RPC transport for frame transactions: devnet config, submit, simulate, lookups.
//
// Which method each endpoint takes (sidecar packages/api/src/app.ts + constants.ts):
// - ethrex (rpc):       eth_sendRawTransaction(raw)       -> hash
// - sidecar / gateway:  eth_sendFrameTransaction(wireTx)  -> hash = keccak256(raw)
//   (the sidecar's own eth_sendRawTransaction is only redirected to ethrex with
//   --redirectRpc and skips the sidecar mempool, so it is never used for admission.)
import { getAddress, type Address, type Hex } from "viem";
import { parseFrameTx, txHash } from "./encoder.ts";
import { EndpointUnavailable, GatewayUnavailable, HashMismatch, MalformedRpcResponse, PopcornError, RequestTimeout, RpcError, SubmitOutcomeUnknown } from "./errors.ts";
import type { FrameTx } from "./types.ts";

// ---------------------------------------------------------------- devnets

/**
 * VERIFY-prefix gas budgets an endpoint ENFORCES, in gas (the declared VERIFY limits + signature cost). `null` = unknown:
 * not measured, never guessed. Sources: contracts/core/SPEC.md "Budgets enforced by the public endpoints" (devnet1) and devnet/README.md (local).
 */
export interface EndpointBudget {
  /** Cap for an unstaked entity (the rule contract). */
  unstaked: number | null;
  /** Cap for a staked entity. null when unknown; equal to `unstaked` for a flat cap. */
  staked: number | null;
}

export interface DevnetBudgets {
  /** The ethrex node's own mempool (`rpcUrl`, eth_sendRawTransaction): a flat cap, staked or not (`--mempool.max-verify-gas`). */
  ethrex: number | null;
  /** The sidecar at `sidecarUrl` (on the local devnet, the patched one with ERC-8421 per-entity budgets). */
  sidecar: EndpointBudget | null;
  /** The gateway at `gatewayUrl`. null fields: unknown (not measured). */
  gateway: EndpointBudget | null;
  /** Where the numbers come from, and what is not known. */
  note: string;
}

export interface DevnetConfig {
  name: string;
  /** Chain id as a number (kept for existing callers). */
  chainId: number;
  /** Same chain id as a bigint (FrameTx.chainId type). Optional for hand-written configs; use devnetChainId(). */
  chainIdBigint?: bigint;
  /** ethrex node: eth_sendRawTransaction, receipts, ethrex_simulateFrameTransaction. */
  rpcUrl: string;
  /** Public ERC-8421 gateway (a skandha sidecar that relays to block builders). */
  gatewayUrl: string;
  /** A sidecar (ERC-8421 mempool node) that admits and relays frame transactions. */
  sidecarUrl: string;
  /** Block explorer base; tx pages are `${explorerUrl}/tx/<hash>`. */
  explorerUrl: string;
  /** Where "auto" submits when set (otherwise: the gateway if it answers, else the node). The public devnet's gateway
   *  answers health checks but drops frame transactions, so there "auto" goes to its sidecar. */
  autoVia?: "gateway" | "rpc" | "sidecar";
  /** The least tip the network's block builders include (wei). The node suggests 1 wei on the public devnet, yet frame
   *  transactions with a tip under about 1 gwei are relayed and never included; at 1 gwei they land within a few blocks. */
  minPriorityFee?: bigint;
  /** What each endpoint enforces. Optional: hand-written configs may omit it; readers fall back to the public 100k. */
  budgets?: DevnetBudgets;
}

export const devnets = {
  devnet1: {
    name: "devnet1",
    chainId: 1337,
    chainIdBigint: 1337n,
    rpcUrl: "https://altmempool.forshtat.com",
    gatewayUrl: "https://altmempoolgateway.forshtat.com/rpc",
    sidecarUrl: "https://altmempool.forshtat.com/rpc",
    explorerUrl: "https://explorer.altmempool.wtf",
    autoVia: "sidecar",
    minPriorityFee: 1_000_000_000n,
    budgets: {
      ethrex: 100_000, // the node's own (canonical) mempool: prefix 100,001 -> "exceeds MAX_VERIFY_GAS"
      sidecar: { unstaked: 10_000_000, staked: 10_000_000 }, // no limit observed: probes up to 10,000,000 pass the budget check
      gateway: { unstaked: null, staked: null }, // not measured
      note: "the public node's own mempool (eth_sendRawTransaction) enforces 100,000; the public sidecar (altmempool.forshtat.com/rpc) enforces no validation limit (probed up to 10,000,000 gas); the gateway's limit has not been measured. Run packages/sdk/scripts/probe-limits.ts to re-measure.",
    },
  },
  // devnet2 / devnet3: add entries here with the same shape when their URLs are published.
  /**
   * Local copy of the organisers' devnet (devnet/up.sh): same ethrex/Lighthouse images and fork schedule,
   * ethrex MAX_VERIFY_GAS 250,000 (public: 100,000), chain id 1338 so nothing signed for one chain is valid on
   * the other. The local patched sidecar runs with auto bundling and doubles as the ERC-8421 gateway (it
   * relays to its own ethrex via ethrex_submitPrivilegedFrameTransaction), so gatewayUrl == sidecarUrl.
   * Explorer: devnet-ui (sidecar admission view; no block view). See devnet/README.md.
   */
  local: {
    name: "local",
    chainId: 1338,
    chainIdBigint: 1338n,
    rpcUrl: "http://127.0.0.1:18545",
    gatewayUrl: "http://127.0.0.1:14338/rpc",
    sidecarUrl: "http://127.0.0.1:14338/rpc",
    explorerUrl: "http://127.0.0.1:14339",
    budgets: {
      ethrex: 250_000, // ethrex --mempool.max-verify-gas=250000 (devnet/docker-compose.yml)
      sidecar: { unstaked: 250_000, staked: 2_500_000 }, // patched sidecar, BUDGET-010
      gateway: { unstaked: 250_000, staked: 2_500_000 }, // the gateway IS the local sidecar (gatewayUrl == sidecarUrl)
      note: "devnet/README.md: ethrex 250,000 flat (it has no stake exception: staked or foreign-reading triggers reach the chain only through the sidecar's privileged submit); the sidecar 250k unstaked / 2.5M staked per entity.",
    },
  },
} as const satisfies Record<string, DevnetConfig>;

export type DevnetName = keyof typeof devnets;

/** A devnet by name, or a full config (e.g. devnet1 with a different local sidecar port). */
export type DevnetSelector = DevnetName | DevnetConfig;

export function getDevnet(d: DevnetSelector = "devnet1"): DevnetConfig {
  if (typeof d !== "string") return d;
  const c = (devnets as Record<string, DevnetConfig>)[d];
  if (!c) throw new PopcornError(`unknown devnet "${d}" (known: ${Object.keys(devnets).join(", ")})`);
  return c;
}

/** The devnet's chain id as a bigint. */
export function devnetChainId(d: DevnetSelector = "devnet1"): bigint {
  const c = getDevnet(d);
  return c.chainIdBigint ?? BigInt(c.chainId);
}

export function explorerTxUrl(hash: Hex, devnet: DevnetSelector = "devnet1"): string {
  return `${getDevnet(devnet).explorerUrl}/tx/${hash}`;
}

/** Where to send: the public gateway, the ethrex node directly, or the local sidecar. */
export type Via = "gateway" | "rpc" | "sidecar";

export function endpointUrl(via: Via, devnet: DevnetSelector = "devnet1"): string {
  const c = getDevnet(devnet);
  return via === "gateway" ? c.gatewayUrl : via === "rpc" ? c.rpcUrl : c.sidecarUrl;
}

// ---------------------------------------------------------------- JSON-RPC

/**
 * Options every transport function accepts.
 * `fetch` defaults to globalThis.fetch (looked up per call, so test stubs work).
 */
export interface TransportOptions {
  devnet?: DevnetSelector;
  /** Per-request timeout in ms (defaults: 30 s, simulate/send 60 s). */
  timeoutMs?: number;
  /** Aborts the request; the abort reason is rethrown as is. */
  signal?: AbortSignal;
  fetch?: typeof fetch;
  /** Extra HTTP headers (e.g. an API key for a hosted gateway). */
  headers?: Record<string, string>;
}

export interface RequestOptions extends Omit<TransportOptions, "devnet"> {
  /** Throw GatewayUnavailable (instead of EndpointUnavailable) on 5xx / unreachable. */
  isGateway?: boolean;
}

let nextId = 1;

function pickRequest(o: TransportOptions | RequestOptions | undefined, extra: Partial<RequestOptions> = {}): RequestOptions {
  const r: RequestOptions = { ...extra };
  if (o?.timeoutMs !== undefined) r.timeoutMs = o.timeoutMs;
  if (o?.signal) r.signal = o.signal;
  if (o?.fetch) r.fetch = o.fetch;
  if (o?.headers) r.headers = o.headers;
  return r;
}

/**
 * One JSON-RPC call.
 * - a JSON-RPC `error` object (on any HTTP status) -> RpcError
 * - any other non-2xx, unreachable host or non-JSON body -> EndpointUnavailable (GatewayUnavailable with isGateway)
 * - per-request timeout -> RequestTimeout; caller's `signal` aborted -> its reason
 * - 2xx JSON without "result" -> MalformedRpcResponse
 */
export async function rpcRequest<T = unknown>(url: string, method: string, params: unknown[], opts: RequestOptions = {}): Promise<T> {
  const Unavailable = opts.isGateway ? GatewayUnavailable : EndpointUnavailable;
  const body = JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }, (_k, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v));
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const timer = AbortSignal.timeout(Math.max(1, timeoutMs));
  const signal = opts.signal ? AbortSignal.any([timer, opts.signal]) : timer;
  const doFetch = opts.fetch ?? globalThis.fetch;
  let res: Response;
  let text: string;
  try {
    res = await doFetch(url, { method: "POST", headers: { "content-type": "application/json", ...opts.headers }, body, signal });
    text = await res.text();
  } catch (e) {
    if (opts.signal?.aborted) throw opts.signal.reason;
    if (timer.aborted) throw new RequestTimeout(url, null, `${method} timed out after ${timeoutMs} ms`, { cause: e });
    throw new Unavailable(url, null, e instanceof Error ? e.message : String(e), { cause: e });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Unavailable(url, res.status, res.ok ? `non-JSON response: ${text.slice(0, 200)}` : text);
  }
  const obj = (json !== null && typeof json === "object" ? json : {}) as { result?: T; error?: { code?: unknown; message?: unknown; data?: unknown } };
  const err = obj.error;
  if (err && typeof err === "object" && typeof err.code === "number") {
    throw new RpcError(url, method, err.code, typeof err.message === "string" ? err.message : JSON.stringify(err.message), err.data);
  }
  if (!res.ok) throw new Unavailable(url, res.status, text);
  if (!("result" in obj)) throw new MalformedRpcResponse(url, method, text);
  return obj.result as T;
}

// ---------------------------------------------------------------- health

export interface HealthResult {
  url: string;
  chainId: number;
}

/**
 * Checks the gateway answers `eth_chainId` with the devnet's chain id. Throws
 * GatewayUnavailable when it returns 5xx, times out or cannot be reached (it returned
 * 502 for a while).
 */
export async function checkGateway(devnet: DevnetSelector = "devnet1", opts: Omit<TransportOptions, "devnet"> = {}): Promise<HealthResult> {
  const c = getDevnet(devnet);
  let hex: Hex;
  try {
    hex = await rpcRequest<Hex>(c.gatewayUrl, "eth_chainId", [], pickRequest(opts, { isGateway: true, timeoutMs: opts.timeoutMs ?? 15_000 }));
  } catch (e) {
    if (e instanceof GatewayUnavailable || !(e instanceof EndpointUnavailable)) throw e;
    throw new GatewayUnavailable(e.url, e.status, e.body, { cause: e });
  }
  const id = Number(hex);
  if (id !== c.chainId) throw new GatewayUnavailable(c.gatewayUrl, null, `wrong chain id ${id}, expected ${c.chainId}`);
  return { url: c.gatewayUrl, chainId: id };
}

/** true / false instead of throwing. */
export async function isGatewayUp(devnet: DevnetSelector = "devnet1", opts: Omit<TransportOptions, "devnet"> = {}): Promise<boolean> {
  try {
    await checkGateway(devnet, opts);
    return true;
  } catch (e) {
    if (e instanceof EndpointUnavailable || e instanceof RpcError || e instanceof MalformedRpcResponse) return false;
    throw e;
  }
}

// ---------------------------------------------------------------- submit

/** The sidecar's JSON shape for eth_sendFrameTransaction (sidecar SendFrameTransaction.dto.ts). */
export function toSidecarWire(tx: FrameTx): Record<string, unknown> {
  const q = (n: bigint) => `0x${n.toString(16)}`;
  return {
    chainId: q(tx.chainId),
    nonceKeys: tx.nonceKeys.map(q),
    nonceSeq: q(tx.nonceSeq),
    sender: tx.sender,
    frames: tx.frames.map((f) => ({
      mode: f.mode,
      flags: f.flags,
      target: f.target,
      limits: { execution: q(f.gasLimit), state: q(f.stateGasLimit) },
      value: q(f.value),
      data: f.data,
    })),
    signatures: tx.signatures.map((s) => ({ scheme: s.scheme, signer: s.signer ?? "0x", msg: s.msg, signature: s.signature })),
    fees: {
      maxPriorityFeePerGas: q(tx.fees.maxPriorityFeePerGas),
      maxFeePerGas: q(tx.fees.maxFeePerGas),
      maxFeePerBlobGas: q(tx.fees.maxFeePerBlobGas),
    },
    blobVersionedHashes: tx.blobHashes,
    recentRootReferences: tx.recentRootReferences.map((r) => ({ sourceId: r.sourceId, slot: q(r.slot), root: r.root })),
  };
}

export interface SendOptions extends TransportOptions {
  via: Via;
}

/** "already known": the endpoint holds this exact tx (identical bytes => identical hash). */
const ALREADY_KNOWN = /already known/i;

/**
 * Submits a serialized frame tx and returns its hash. `rpc` uses ethrex
 * eth_sendRawTransaction(raw); `gateway` and `sidecar` decode the raw bytes and use
 * eth_sendFrameTransaction(wire).
 * - "already known" -> success (returns the hash)
 * - request timeout -> SubmitOutcomeUnknown (it may have been accepted; watch the hash)
 * - endpoint hash != keccak256(raw) -> HashMismatch (our encoding would differ from the endpoint's)
 */
export async function sendFrameTransaction(raw: Hex, opts: SendOptions): Promise<Hex> {
  const url = endpointUrl(opts.via, opts.devnet);
  const expected = txHash(raw);
  const reqOpts = pickRequest(opts, { isGateway: opts.via === "gateway", timeoutMs: opts.timeoutMs ?? 60_000 });
  let result: Hex;
  try {
    result =
      opts.via === "rpc"
        ? await rpcRequest<Hex>(url, "eth_sendRawTransaction", [raw], reqOpts)
        : await rpcRequest<Hex>(url, "eth_sendFrameTransaction", [toSidecarWire(parseFrameTx(raw))], reqOpts);
  } catch (e) {
    if (e instanceof RpcError && ALREADY_KNOWN.test(e.rpcMessage)) return expected;
    if (e instanceof RequestTimeout) throw new SubmitOutcomeUnknown(expected, url, { cause: e });
    throw e;
  }
  if (typeof result !== "string" || result.toLowerCase() !== expected) throw new HashMismatch(expected, result, opts.via);
  return expected;
}

// ---------------------------------------------------------------- simulate

export interface SimulatedFrame {
  gasUsed: bigint;
  succeeded: boolean;
}

/** ethrex_simulateFrameTransaction result (shape measured in core/experiments/log.jsonl). */
export interface SimulationResult {
  /** `"success"` / `"reverted"` (SENDER frames) when the tx is valid; `null` when it is invalid. */
  executionStatus: "success" | "reverted" | null;
  /** Why the tx is invalid (e.g. `Nonce mismatch: expected 1, got 0`, a failed VERIFY frame). */
  executionError: string | null;
  canonicalMempoolValid: boolean;
  canonicalMempoolViolation: string | null;
  /** e.g. `SelfVerify` (rule-pays), `OnlyVerifyPay` (caller-pays). */
  prefixShape: string | null;
  payer: Address | null;
  gasUsed: bigint | null;
  maxCost: bigint | null;
  frames: SimulatedFrame[] | null;
  failedFrameIndex: number | null;
  haltReason: string | null;
  haltDetail: string | null;
  revertData: Hex | null;
  /** ERC-7562 call trace when requested with trace: true. */
  trace: unknown;
  traceError: string | null;
  /** The untouched JSON result. */
  raw: Record<string, unknown>;
}

const big = (v: unknown): bigint | null => (typeof v === "string" && v.startsWith("0x") ? BigInt(v) : typeof v === "number" ? BigInt(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function parseSimulationResult(r: Record<string, unknown>): SimulationResult {
  const frames = Array.isArray(r.frames)
    ? (r.frames as { gasUsed: unknown; succeeded: unknown }[]).map((f) => ({ gasUsed: big(f.gasUsed) ?? 0n, succeeded: f.succeeded === true }))
    : null;
  const status = r.executionStatus;
  return {
    executionStatus: status === "success" || status === "reverted" ? status : null,
    executionError: str(r.executionError),
    canonicalMempoolValid: r.canonicalMempoolValid === true,
    canonicalMempoolViolation: str(r.canonicalMempoolViolation),
    prefixShape: str(r.prefixShape),
    payer: typeof r.payer === "string" ? getAddress(r.payer) : null,
    gasUsed: big(r.gasUsed),
    maxCost: big(r.maxCost),
    frames,
    failedFrameIndex: typeof r.failedFrameIndex === "number" ? r.failedFrameIndex : null,
    haltReason: str(r.haltReason),
    haltDetail: str(r.haltDetail),
    revertData: (str(r.revertData) as Hex | null) ?? null,
    trace: r.erc7562Trace ?? null,
    traceError: str(r.erc7562TraceError),
    raw: r,
  };
}

export interface SimulateOptions extends TransportOptions {
  /** Block tag, default "latest". */
  block?: string;
  /**
   * Ask ethrex for the ERC-7562 call trace (`result.trace`). Default **true**, because
   * the client and simulator map rule violations from it; pass false for a smaller, faster response.
   */
  trace?: boolean;
}

/** ethrex_simulateFrameTransaction(raw, block, { trace }) on the devnet's ethrex node. */
export async function simulateFrameTransaction(raw: Hex, opts: SimulateOptions = {}): Promise<SimulationResult> {
  const c = getDevnet(opts.devnet);
  const r = await rpcRequest<Record<string, unknown>>(
    c.rpcUrl,
    "ethrex_simulateFrameTransaction",
    [raw, opts.block ?? "latest", { trace: opts.trace ?? true }],
    pickRequest(opts, { timeoutMs: opts.timeoutMs ?? 60_000 }),
  );
  if (r === null || typeof r !== "object") throw new MalformedRpcResponse(c.rpcUrl, "ethrex_simulateFrameTransaction", JSON.stringify(r));
  return parseSimulationResult(r);
}

// ---------------------------------------------------------------- node lookups

/** Per-frame status in a receipt: ethrex writes 0x0 fail, 0x1 ok, 0x2 skipped (FRAMEPARAM 0x05). */
export type FrameStatus = "success" | "reverted" | "skipped";

export interface FrameReceipt {
  status: FrameStatus;
  gasUsed: bigint;
  stateGasUsed: bigint;
  logs: unknown[];
}

export interface FrameTxReceipt {
  transactionHash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  status: "success" | "reverted";
  gasUsed: bigint;
  effectiveGasPrice: bigint | null;
  payer: Address | null;
  from: Address | null;
  frameReceipts: FrameReceipt[];
  raw: Record<string, unknown>;
}

function quantity(v: unknown): bigint | null {
  try {
    if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
    if (typeof v === "string" && v.length > 0) return BigInt(v);
  } catch {
    /* not a quantity */
  }
  return null;
}

export function parseReceipt(r: Record<string, unknown>): FrameTxReceipt {
  // BigInt parsing, so "0x01" == 1 == success
  const txStatus = (v: unknown): "success" | "reverted" => (quantity(v) === 1n ? "success" : "reverted");
  const frameStatus = (v: unknown): FrameStatus => {
    const q = quantity(v);
    return q === 1n ? "success" : q === 2n ? "skipped" : "reverted";
  };
  return {
    transactionHash: r.transactionHash as Hex,
    blockNumber: quantity(r.blockNumber) ?? 0n,
    blockHash: r.blockHash as Hex,
    status: txStatus(r.status),
    gasUsed: quantity(r.gasUsed) ?? 0n,
    effectiveGasPrice: quantity(r.effectiveGasPrice),
    payer: typeof r.payer === "string" ? getAddress(r.payer) : null,
    from: typeof r.from === "string" ? getAddress(r.from) : null,
    frameReceipts: Array.isArray(r.frameReceipts)
      ? (r.frameReceipts as Record<string, unknown>[]).map((f) => ({
          status: frameStatus(f.status),
          gasUsed: quantity(f.gasUsed) ?? 0n,
          stateGasUsed: quantity(f.stateGasUsed) ?? 0n,
          logs: Array.isArray(f.logs) ? f.logs : [],
        }))
      : [],
    raw: r,
  };
}

/** eth_getTransactionReceipt on the ethrex node; null while not included. */
export async function getReceipt(hash: Hex, opts: TransportOptions = {}): Promise<FrameTxReceipt | null> {
  const r = await rpcRequest<Record<string, unknown> | null>(getDevnet(opts.devnet).rpcUrl, "eth_getTransactionReceipt", [hash], pickRequest(opts));
  return r ? parseReceipt(r) : null;
}

/** eth_getTransactionByHash on the ethrex node: `pending` (in its mempool), `mined`, or null (unknown). */
export async function getNodeTxState(hash: Hex, opts: TransportOptions = {}): Promise<"pending" | "mined" | null> {
  const r = await rpcRequest<{ blockNumber?: string | null } | null>(getDevnet(opts.devnet).rpcUrl, "eth_getTransactionByHash", [hash], pickRequest(opts));
  if (!r) return null;
  return r.blockNumber ? "mined" : "pending";
}

// ---------------------------------------------------------------- sidecar / gateway admission

/**
 * Admission as a sidecar sees it. From skandha_explorer_getTransaction
 * (`admission.outcome`: rejected | accepted | included | replaced | dropped) when the
 * explorer is enabled, else skandha_frameTransactionStatus (mempool entry status:
 * New | Pending | Submitted | OnChain | Finalized | Cancelled | Reverted).
 * When a live mempool entry exists its status wins over the admission record.
 */
export interface AdmissionStatus {
  known: boolean;
  outcome: "accepted" | "rejected" | "included" | "replaced" | "dropped" | null;
  /** mempool entry status (skandha MempoolEntryStatus name) when the tx is still in the pool */
  entryStatus: string | null;
  reason: string | null;
  method: "skandha_explorer_getTransaction" | "skandha_frameTransactionStatus";
}

// "Frame transaction not found" (INVALID_REQUEST -32600). A disabled explorer answers
// METHOD_NOT_FOUND (-32601) "Explorer is disabled", which triggers the fallback instead.
const NOT_FOUND = /transaction not found/i;
const ENTRY_STATUS_NAMES = ["New", "Pending", "Submitted", "OnChain", "Finalized", "Cancelled", "Reverted"];

function entryOutcome(status: string): AdmissionStatus["outcome"] {
  if (status === "Cancelled" || status === "Reverted") return "dropped";
  if (status === "OnChain" || status === "Finalized") return "included";
  return "accepted";
}

function entryStatusName(v: unknown): string | null {
  if (typeof v === "string") {
    const q = v.startsWith("0x") ? quantity(v) : null;
    return q !== null ? (ENTRY_STATUS_NAMES[Number(q)] ?? v) : v;
  }
  if (typeof v === "number") return ENTRY_STATUS_NAMES[v] ?? String(v);
  return null;
}

export async function getAdmissionStatus(hash: Hex, url: string, opts: RequestOptions = {}): Promise<AdmissionStatus> {
  const unknown = (method: AdmissionStatus["method"]): AdmissionStatus => ({ known: false, outcome: null, entryStatus: null, reason: null, method });
  try {
    const r = await rpcRequest<{
      entry: { status?: string | number; revertReason?: string | null } | null;
      admission: { outcome: AdmissionStatus["outcome"]; checks?: { rule: string; verdict: string; detail?: string }[]; errorCode?: number } | null;
    } | null>(url, "skandha_explorer_getTransaction", [hash], opts);
    if (!r || (!r.entry && !r.admission)) return unknown("skandha_explorer_getTransaction");
    const entryStatus = r.entry ? entryStatusName(r.entry.status) : null;
    const failed = r.admission?.checks?.find((c) => c.verdict === "fail");
    return {
      known: true,
      outcome: entryStatus ? entryOutcome(entryStatus) : (r.admission?.outcome ?? null),
      entryStatus,
      reason: r.entry?.revertReason ?? (failed ? `${failed.rule}${failed.detail ? `: ${failed.detail}` : ""}` : null),
      method: "skandha_explorer_getTransaction",
    };
  } catch (e) {
    if (!(e instanceof RpcError)) throw e;
    if (e.code !== -32601 && NOT_FOUND.test(e.rpcMessage)) return unknown("skandha_explorer_getTransaction");
    if (e.code !== -32601) throw e;
    // explorer disabled on this sidecar: fall back to the mempool status method
  }
  try {
    const s = await rpcRequest<{ status: string | number; reason?: string | null }>(url, "skandha_frameTransactionStatus", [hash], opts);
    const status = entryStatusName(s.status) ?? "New";
    return { known: true, outcome: entryOutcome(status), entryStatus: status, reason: s.reason ?? null, method: "skandha_frameTransactionStatus" };
  } catch (e) {
    if (e instanceof RpcError && NOT_FOUND.test(e.rpcMessage)) return unknown("skandha_frameTransactionStatus");
    throw e;
  }
}

/** The VERIFY-prefix cap of the devnet's own ethrex mempool (public rules): `budgets.ethrex`, else the public 100,000. */
export function publicPrefixBudget(d: DevnetSelector = "devnet1"): number {
  return getDevnet(d).budgets?.ethrex ?? 100_000;
}
