// Regression tests for edge cases in the encoder, the transport, validation and watch(): malformed inputs, limits
// and error paths.
import { getEventListeners } from "node:events";
import { bytesToHex, concat, hexToBytes, recoverAddress, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { minimalTrigger } from "./reference.ts";
import { arbitraryEntry, parseFrameTx, serializeFrameTx, signatureHash, signSecp256k1Entry } from "../src/encoder.ts";
import {
  EndpointUnavailable,
  FrameTxDecodeError,
  FrameTxEncodeError,
  FrameTxInvalid,
  GatewayUnavailable,
  HashMismatch,
  MalformedRpcResponse,
  RequestTimeout,
  RpcError,
  SubmitOutcomeUnknown,
  WatchTimeout,
} from "../src/errors.ts";
import { rlpEncode, type RlpItem } from "../src/rlp.ts";
import {
  devnetChainId,
  devnets,
  getAdmissionStatus,
  getReceipt,
  parseReceipt,
  rpcRequest,
  sendFrameTransaction,
  simulateFrameTransaction,
  type DevnetConfig,
} from "../src/transport.ts";
import { FrameFlags, FrameMode, SignatureScheme, type Frame, type FrameTx } from "../src/types.ts";
import { assertValidFrameTx, validateFrameTx } from "../src/validate.ts";
import { watch, type SourceError, type WatchStatus } from "../src/watch.ts";
import { SPEC_VECTORS } from "./fixtures/spec-vectors.ts";

const d = devnets.devnet1;
const raw = SPEC_VECTORS[1]!.raw;
const hash = SPEC_VECTORS[1]!.txHash;
afterEach(() => vi.unstubAllGlobals());

type Fake = (url: string, method: string, init: RequestInit) => Response | Promise<Response>;
function stub(fn: Fake) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => fn(url, JSON.parse(String(init.body)).method, init));
}
const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
const rpcErr = (code: number, message: string, status = 200) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code, message } }), { status });
const http = (status: number, body = "x") => new Response(body, { status });
const rate429 = () => new Response(JSON.stringify({ message: "Too Many Requests" }), { status: 429 });
const hang: Fake = (_u, _m, init) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)));
const receipt = (status = "0x1") => ({
  blockHash: `0x${"ab".repeat(32)}`, blockNumber: "0x10", gasUsed: "0x5208", status, transactionHash: hash, payer: d.rpcUrl && "0xb3e29c868351ea79e9e66a028ffca365d47054bf",
  frameReceipts: [{ status: "0x1", gasUsed: "0x1", stateGasUsed: "0x0", logs: [] }, { status: "0x0", gasUsed: "0x2", stateGasUsed: "0x0", logs: [] }],
});

// ---------------------------------------------------------------- #2 #7 rpcRequest

describe("#2/#7 rpcRequest status and body handling", () => {
  it("F1: HTTP 429 with a JSON body without `error` -> EndpointUnavailable(429), not null", async () => {
    stub(() => rate429());
    const e = await getReceipt(hash).catch((x) => x);
    expect(e).toBeInstanceOf(EndpointUnavailable);
    expect(e.status).toBe(429);
  });
  it("4xx with a JSON body without `error` (404) -> EndpointUnavailable(404)", async () => {
    stub(() => new Response(JSON.stringify({ message: "not here" }), { status: 404 }));
    await expect(rpcRequest(d.rpcUrl, "eth_chainId", [])).rejects.toMatchObject({ status: 404 });
  });
  it("4xx carrying a JSON-RPC error -> RpcError with its code", async () => {
    stub(() => rpcErr(-32602, "invalid params", 400));
    await expect(rpcRequest(d.rpcUrl, "eth_chainId", [])).rejects.toMatchObject({ constructor: RpcError, code: -32602 });
  });
  it("F1b: 200 with neither result nor error -> MalformedRpcResponse", async () => {
    stub(() => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1 }), { status: 200 }));
    await expect(rpcRequest(d.rpcUrl, "eth_getTransactionReceipt", [hash])).rejects.toBeInstanceOf(MalformedRpcResponse);
  });
  it("200 with result: null is a valid null", async () => {
    stub(() => ok(null));
    expect(await rpcRequest(d.rpcUrl, "eth_getTransactionReceipt", [hash])).toBeNull();
  });
  it("F2: HTTP 500 carrying a JSON-RPC rejection from the gateway -> RpcError, not GatewayUnavailable", async () => {
    stub(() => rpcErr(-32000, "nonce key already held", 500));
    const e = await sendFrameTransaction(raw, { via: "gateway" }).catch((x) => x);
    expect(e).toBeInstanceOf(RpcError);
    expect(e).not.toBeInstanceOf(GatewayUnavailable);
    expect(e.rpcMessage).toBe("nonce key already held");
  });
  it("HTTP 502 HTML from the gateway is still GatewayUnavailable", async () => {
    stub(() => http(502, "<html>bad gateway</html>"));
    await expect(sendFrameTransaction(raw, { via: "gateway" })).rejects.toBeInstanceOf(GatewayUnavailable);
  });
  it("request timeout -> RequestTimeout", async () => {
    stub(hang);
    const t0 = Date.now();
    await expect(rpcRequest(d.rpcUrl, "eth_chainId", [], { timeoutMs: 50 })).rejects.toBeInstanceOf(RequestTimeout);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("caller's signal aborts with its own reason", async () => {
    stub(hang);
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error("stop")), 20);
    await expect(rpcRequest(d.rpcUrl, "eth_chainId", [], { signal: ac.signal })).rejects.toThrow("stop");
  });
});

describe("#7 sendFrameTransaction outcomes", () => {
  it("timeout after send -> SubmitOutcomeUnknown carrying the hash", async () => {
    stub(hang);
    const e = await sendFrameTransaction(raw, { via: "rpc", timeoutMs: 50 }).catch((x) => x);
    expect(e).toBeInstanceOf(SubmitOutcomeUnknown);
    expect(e.txHash).toBe(hash);
    expect(e.cause).toBeInstanceOf(RequestTimeout);
  });
  it.each([
    ["sidecar", "Frame transaction already known"],
    ["rpc", "already known"],
  ] as const)("%s: '%s' for the same tx -> success with keccak256(raw)", async (via, msg) => {
    stub(() => rpcErr(-32602, msg));
    expect(await sendFrameTransaction(raw, { via })).toBe(hash);
  });
  it("other rejections still throw", async () => {
    stub(() => rpcErr(-32602, "Frame transaction cannot be replaced: fee too low"));
    await expect(sendFrameTransaction(raw, { via: "sidecar" })).rejects.toBeInstanceOf(RpcError);
  });
  it("hash mismatch -> HashMismatch with both hashes", async () => {
    const other = `0x${"00".repeat(32)}`;
    stub(() => ok(other));
    const e = await sendFrameTransaction(raw, { via: "rpc" }).catch((x) => x);
    expect(e).toBeInstanceOf(HashMismatch);
    expect(e).toMatchObject({ expected: hash, actual: other, via: "rpc" });
  });
});

// ---------------------------------------------------------------- #9 options

describe("#9 transport options", () => {
  it("fetch, headers, devnet and signal are passed through", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const myFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return ok({ executionStatus: "success", frames: [], canonicalMempoolValid: true });
    }) as unknown as typeof fetch;
    const custom: DevnetConfig = { ...d, name: "x", rpcUrl: "http://custom.invalid" };
    const s = await simulateFrameTransaction(raw, { devnet: custom, fetch: myFetch, headers: { "x-api-key": "k" }, signal: new AbortController().signal });
    expect(s.executionStatus).toBe("success");
    expect(seen[0]!.url).toBe("http://custom.invalid");
    expect(seen[0]!.headers).toMatchObject({ "content-type": "application/json", "x-api-key": "k" });
  });
  it("devnetChainId returns a bigint; chainId stays a number", () => {
    expect(devnetChainId()).toBe(1337n);
    expect(devnetChainId({ ...d, chainIdBigint: undefined } as DevnetConfig)).toBe(1337n);
    expect(d.chainId).toBe(1337);
  });
});

// ---------------------------------------------------------------- #5 receipts

describe("#5 receipt status parsing", () => {
  it("F3: '0x01' is success, frame 0x2 is skipped, 0x0 reverted", () => {
    const r = parseReceipt({ status: "0x01", frameReceipts: [{ status: "0x2" }, { status: "0x0" }, { status: "0x1" }, { status: 1 }] });
    expect(r.status).toBe("success");
    expect(r.frameReceipts.map((f) => f.status)).toEqual(["skipped", "reverted", "success", "success"]);
    expect(parseReceipt({ status: "0x0" }).status).toBe("reverted");
  });
});

// ---------------------------------------------------------------- #6 admission status

describe("#6 admission status", () => {
  it("F6: explorer {entry: null, admission: null} -> unknown", async () => {
    stub(() => ok({ entry: null, admission: null, events: [] }));
    expect(await getAdmissionStatus(hash, d.sidecarUrl)).toMatchObject({ known: false, outcome: null });
  });
  it("entry without admission -> derived from entry.status", async () => {
    stub(() => ok({ entry: { status: "Pending" }, admission: null, events: [] }));
    expect(await getAdmissionStatus(hash, d.sidecarUrl)).toMatchObject({ known: true, outcome: "accepted", entryStatus: "Pending" });
  });
  it("Cancelled entry with an 'accepted' admission record -> dropped", async () => {
    stub(() => ok({ entry: { status: "Cancelled", revertReason: "evicted" }, admission: { outcome: "accepted", checks: [] }, events: [] }));
    expect(await getAdmissionStatus(hash, d.sidecarUrl)).toMatchObject({ outcome: "dropped", reason: "evicted" });
  });
  it("a non-not-found explorer RpcError propagates (watch treats it as unavailable)", async () => {
    stub(() => rpcErr(-32005, "rate limited"));
    await expect(getAdmissionStatus(hash, d.sidecarUrl)).rejects.toMatchObject({ code: -32005 });
  });
});

// ---------------------------------------------------------------- #1 #3 #4 #10 watch

describe("#1/#3/#4 watch robustness", () => {
  it("F4: one transient node 502 does not abort; keeps polling to inclusion", async () => {
    let n = 0;
    stub((url, m) => {
      if (url === d.gatewayUrl) return http(502);
      if (m === "eth_getTransactionReceipt") {
        n++;
        if (n === 2) return http(502, "bad gateway");
        return ok(n >= 4 ? receipt() : null);
      }
      return ok({ blockNumber: null });
    });
    const errors: SourceError[] = [];
    const s = await watch(hash, { intervalMs: 1, timeoutMs: 5000, onError: (e) => errors.push(e) });
    expect(s.state).toBe("included");
    expect(errors.some((e) => e.source === "receipt" && e.error instanceof EndpointUnavailable)).toBe(true);
  });

  it("F5: a mempool rate-limit RpcError does not abort", async () => {
    let n = 0;
    stub((url, m) => {
      if (url === d.gatewayUrl) return rpcErr(-32005, "rate limited");
      if (m === "eth_getTransactionReceipt") return ok(++n >= 3 ? receipt() : null);
      return ok({ blockNumber: null });
    });
    const seen: WatchStatus[] = [];
    const s = await watch(hash, { intervalMs: 1, timeoutMs: 5000, onStatus: (x) => seen.push(x) });
    expect(s.state).toBe("included");
    expect(seen[0]).toEqual({ state: "admitted", by: ["node"], unavailable: ["gateway"] });
  });

  it("F6: explorer knows nothing ({entry:null, admission:null}) -> waiting, not dropped", async () => {
    stub((url) => (url === d.sidecarUrl ? ok({ entry: null, admission: null, events: [] }) : ok(null)));
    const e = await watch(hash, { intervalMs: 5, timeoutMs: 60, mempools: ["sidecar"] }).catch((x) => x);
    expect(e).toBeInstanceOf(WatchTimeout);
    expect(e.last).toEqual({ state: "waiting", unavailable: [] });
  });

  it("F7: receipts rate-limited (429) on a mined tx -> admitted with node unavailable, never a false result", async () => {
    stub((url, m) => {
      if (url === d.gatewayUrl) return http(502);
      if (m === "eth_getTransactionReceipt") return rate429();
      return ok({ blockNumber: "0x10" });
    });
    const e = await watch(hash, { intervalMs: 1, timeoutMs: 50 }).catch((x) => x);
    expect(e).toBeInstanceOf(WatchTimeout);
    expect(e.last).toEqual({ state: "admitted", by: ["node"], unavailable: ["node", "gateway"] });
  });

  it("F1c: node seen pending, then rate-limited -> not dropped", async () => {
    let n = 0;
    stub((url, m) => {
      if (url === d.gatewayUrl) return http(502);
      if (m === "eth_getTransactionByHash" && n++ === 0) return ok({ blockNumber: null });
      return rate429();
    });
    const e = await watch(hash, { intervalMs: 1, timeoutMs: 80, missingPollsBeforeDropped: 2 }).catch((x) => x);
    expect(e).toBeInstanceOf(WatchTimeout);
    expect(e.last.state).toBe("admitted");
  });

  it("F9 (#1): gateway admitted it, then flaps to 502 -> not dropped while unknown", async () => {
    let g = 0;
    stub((url) => {
      if (url === d.gatewayUrl) return g++ === 0 ? ok({ entry: { status: "New" }, admission: { outcome: "accepted" } }) : http(502);
      return ok(null);
    });
    const e = await watch(hash, { intervalMs: 1, timeoutMs: 80, missingPollsBeforeDropped: 2 }).catch((x) => x);
    expect(e).toBeInstanceOf(WatchTimeout);
    expect(e.last).toEqual({ state: "admitted", by: ["gateway"], unavailable: [] });
  });

  it("#1: still drops once every source answers without the tx", async () => {
    let g = 0;
    stub((url) => {
      if (url === d.gatewayUrl) return g++ === 0 ? ok({ entry: { status: "New" }, admission: { outcome: "accepted" } }) : rpcErr(-32600, "Frame transaction not found");
      return ok(null);
    });
    expect(await watch(hash, { intervalMs: 1, timeoutMs: 2000, missingPollsBeforeDropped: 2 })).toMatchObject({ state: "dropped", by: "node" });
  });

  it("a rejection is not final while another configured source is unavailable", async () => {
    stub((url) => {
      if (url === d.gatewayUrl) return http(502);
      if (url === d.sidecarUrl) return ok({ entry: null, admission: { outcome: "rejected", checks: [] } });
      return ok(null);
    });
    const e = await watch(hash, { intervalMs: 1, timeoutMs: 40, mempools: ["gateway", "sidecar"] }).catch((x) => x);
    expect(e).toBeInstanceOf(WatchTimeout);
  });

  it("F8 (#4): a hanging node is cut off at timeoutMs", async () => {
    stub(hang);
    const t0 = Date.now();
    const e = await watch(hash, { intervalMs: 1, timeoutMs: 100, mempools: [] }).catch((x) => x);
    const took = Date.now() - t0;
    expect(e).toBeInstanceOf(WatchTimeout);
    expect(took).toBeGreaterThanOrEqual(95);
    expect(took).toBeLessThan(1000);
  });

  it("#4: the deadline applies during the sleep too", async () => {
    stub(() => ok(null));
    const t0 = Date.now();
    await expect(watch(hash, { intervalMs: 10_000, timeoutMs: 60, mempools: [] })).rejects.toBeInstanceOf(WatchTimeout);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("abort via signal rejects promptly with the reason (during a request and during sleep)", async () => {
    stub(hang);
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error("user abort")), 30);
    await expect(watch(hash, { intervalMs: 1, timeoutMs: 10_000, mempools: [], signal: ac.signal })).rejects.toThrow("user abort");
    stub(() => ok(null));
    const ac2 = new AbortController();
    setTimeout(() => ac2.abort(new Error("abort 2")), 30);
    await expect(watch(hash, { intervalMs: 10_000, timeoutMs: 20_000, mempools: [], signal: ac2.signal })).rejects.toThrow("abort 2");
  });

  it("reverted receipt -> included with status reverted and per-frame statuses", async () => {
    stub((url, m) => (m === "eth_getTransactionReceipt" ? ok(receipt("0x0")) : ok(null)));
    const s = await watch(hash, { intervalMs: 1, mempools: [] });
    expect(s).toMatchObject({ state: "included", status: "reverted", blockNumber: 16n });
    if (s.state === "included") expect(s.receipt.frameReceipts.map((f) => f.status)).toEqual(["success", "reverted"]);
  });

  it("#10: sleep does not leak abort listeners on the caller's signal", async () => {
    let n = 0;
    stub((_u, m) => (m === "eth_getTransactionReceipt" ? ok(++n >= 30 ? receipt() : null) : ok({ blockNumber: null })));
    const ac = new AbortController();
    await watch(hash, { intervalMs: 1, mempools: [], signal: ac.signal });
    expect(getEventListeners(ac.signal, "abort").length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------- #8 validateFrameTx

describe("#8 validateFrameTx (ethrex validate_static_constraints)", () => {
  const base = parseFrameTx(SPEC_VECTORS[1]!.raw);
  const ruleContract = base.sender;
  const fr = (p: Partial<Frame>): Frame => ({ mode: FrameMode.SENDER, flags: 0, target: null, gasLimit: 1n, stateGasLimit: 0n, value: 0n, data: "0x", ...p });

  it("the three SPEC vectors and a minimal hand-built trigger are valid", () => {
    for (const v of SPEC_VECTORS) expect(validateFrameTx(parseFrameTx(v.raw))).toEqual([]);
    expect(validateFrameTx(minimalTrigger("0xd6dcb9a98b01df724773925adee09fea248fa5f3", 1n))).toEqual([]);
  });

  const cases: [string, FrameTx, RegExp][] = [
    ["zero sender", { ...base, sender: "0x0000000000000000000000000000000000000000" }, /sender must not be zero/],
    ["no nonce keys", { ...base, nonceKeys: [] }, /nonce_keys count/],
    ["17 nonce keys", { ...base, nonceKeys: Array.from({ length: 17 }, (_, i) => BigInt(i + 1)) }, /nonce_keys count/],
    ["keys not increasing", { ...base, nonceKeys: [5n, 5n] }, /strictly increasing/],
    ["key 0 with others", { ...base, nonceKeys: [0n, 1n] }, /key 0 is only valid as the sole/],
    ["nonce_seq 2^64-1", { ...base, nonceSeq: (1n << 64n) - 1n }, /nonce_seq must be < 2\*\*64 - 1/],
    ["17 roots", { ...base, recentRootReferences: Array.from({ length: 17 }, () => ({ sourceId: `0x${"11".repeat(32)}` as Hex, slot: 1n, root: `0x${"22".repeat(32)}` as Hex })) }, /recent_root_references count/],
    ["no frames", { ...base, frames: [] }, /Frame count/],
    ["65 frames", { ...base, frames: Array.from({ length: 65 }, () => fr({})) }, /Frame count/],
    ["blob hash wrong version", { ...base, blobHashes: [`0x02${"00".repeat(31)}`] }, /wrong version byte/],
    ["7 blobs", { ...base, blobHashes: Array.from({ length: 7 }, () => `0x01${"00".repeat(31)}` as Hex) }, /Blob count must not exceed 6/],
    ["blob fee with no blobs", { ...base, fees: { ...base.fees, maxFeePerBlobGas: 1n } }, /max_fee_per_blob_gas must be zero/],
    ["ARBITRARY with signer", { ...base, signatures: [{ ...arbitraryEntry(), signer: ruleContract }] }, /ARBITRARY signatures must not name a signer/],
    ["unknown scheme", { ...base, signatures: [{ ...arbitraryEntry(), scheme: 7 as never }] }, /unsupported scheme 7/],
    ["msg 31 bytes", { ...base, signatures: [{ ...arbitraryEntry(), msg: `0x${"11".repeat(31)}` }] }, /msg must be empty or 32 bytes, got 31/],
    ["msg zero digest", { ...base, signatures: [{ ...arbitraryEntry(), msg: `0x${"00".repeat(32)}` }] }, /must not be zero digest/],
    ["mode 3", { ...base, frames: [fr({ mode: 3 as never })] }, /reserved execution mode 3/],
    ["mode 5 (UTXO)", { ...base, frames: [fr({ mode: 5 as never })] }, /UTXO frames are not active/],
    ["flag bit 3", { ...base, frames: [fr({ flags: 0x08 })] }, /reserved flag bits/],
    ["value on VERIFY", { ...base, frames: [fr({ mode: FrameMode.VERIFY, value: 1n })] }, /non-zero value only allowed in SENDER/],
    ["value on DEFAULT", { ...base, frames: [fr({ mode: FrameMode.DEFAULT, value: 1n })] }, /non-zero value only allowed in SENDER/],
    ["gas_limit > 2^63-1", { ...base, frames: [fr({ gasLimit: 1n << 63n })] }, /gas_limit .* exceeds 2\*\*63-1/],
    ["cumulative gas > 2^63-1", { ...base, frames: [fr({ gasLimit: 1n << 62n, stateGasLimit: 1n << 62n })] }, /cumulative frame gas_limit/],
    ["APPROVE_EXECUTION on another target", { ...base, frames: [fr({ mode: FrameMode.VERIFY, flags: FrameFlags.APPROVE_EXECUTION, target: "0x0000000000000000000000000000000000000001" })] }, /APPROVE_EXECUTION requires an empty target or tx.sender/],
    ["atomic on VERIFY", { ...base, frames: [fr({ mode: FrameMode.VERIFY, flags: FrameFlags.ATOMIC_BATCH }), fr({})] }, /atomic batch flag on a VERIFY frame/],
    ["atomic on last frame", { ...base, frames: [fr({ flags: FrameFlags.ATOMIC_BATCH })] }, /atomic batch flag on last frame/],
    ["atomic followed by VERIFY", { ...base, frames: [fr({ flags: FrameFlags.ATOMIC_BATCH }), fr({ mode: FrameMode.VERIFY })] }, /followed by a VERIFY frame/],
    ["scope inside a batch", { ...base, frames: [fr({ flags: FrameFlags.ATOMIC_BATCH }), fr({ flags: 0x01 })] }, /in an atomic batch must not approve a scope/],
    ["expiry verifier with flags", { ...base, frames: [fr({ mode: FrameMode.VERIFY, target: "0x0000000000000000000000000000000000008141", flags: 1, data: "0x0000000000000001" })] }, /expiry verifier frame must have flags == 0/],
    ["expiry verifier data 7 bytes", { ...base, frames: [fr({ mode: FrameMode.VERIFY, target: "0x0000000000000000000000000000000000008141", data: "0x00000000000001" })] }, /data must be 8 bytes/],
    ["two expiry verifiers", { ...base, frames: [0, 1].map(() => fr({ mode: FrameMode.VERIFY, target: "0x0000000000000000000000000000000000008141", data: "0x0000000000000001" })) }, /more than one expiry verifier/],
  ];
  it.each(cases)("flags: %s", (_n, tx, re) => {
    const issues = validateFrameTx(tx);
    expect(issues.some((m) => re.test(m))).toBe(true);
    expect(() => assertValidFrameTx(tx)).toThrow(FrameTxInvalid);
  });
  it("expiry verifier with the right shape and a valid atomic pair pass", () => {
    const tx: FrameTx = {
      ...base,
      frames: [fr({ mode: FrameMode.VERIFY, target: "0x0000000000000000000000000000000000008141", data: "0x0000000000000001" }), ...base.frames, fr({ flags: FrameFlags.ATOMIC_BATCH }), fr({})],
    };
    expect(validateFrameTx(tx)).toEqual([]);
  });
});

// ---------------------------------------------------------------- #8 encoder / decoder consistency, #11 decoder cases

describe("#8 serializeFrameTx mode/scheme checks consistent with parseFrameTx", () => {
  const base = parseFrameTx(SPEC_VECTORS[0]!.raw);
  const mode3: FrameTx = { ...base, frames: [{ ...base.frames[0]!, mode: 3 as never }] };
  const scheme3: FrameTx = { ...base, signatures: [{ ...arbitraryEntry(), scheme: 3 as never }] };
  it.each([
    ["mode 3", mode3],
    ["scheme 3", scheme3],
  ] as const)("%s: rejected by default, encodable with { unsafe: true }, then rejected by the decoder", (_n, tx) => {
    expect(() => serializeFrameTx(tx)).toThrow(FrameTxEncodeError);
    expect(() => signatureHash(tx)).toThrow(FrameTxEncodeError);
    const rawUnsafe = serializeFrameTx(tx, { unsafe: true });
    expect(() => parseFrameTx(rawUnsafe)).toThrow(FrameTxDecodeError);
    expect(signatureHash(tx, { unsafe: true })).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("#11 decoder: more malformed inputs", () => {
  const e = (h: Hex) => hexToBytes(h);
  const items = (frameTarget: Uint8Array = new Uint8Array(), sigs: RlpItem = []): RlpItem[] => [
    e("0x0539"),
    [e("0x07d4")],
    new Uint8Array(),
    e("0xec3bd98961e0931090950bf84ff64fabe60ad948"),
    [[e("0x02"), new Uint8Array(), frameTarget, [e("0x7530"), new Uint8Array()], new Uint8Array(), new Uint8Array()]],
    sigs,
    [e("0x3b9aca00"), e("0x77359400"), new Uint8Array()],
    [],
    [],
  ];
  const tx = (it: RlpItem[]) => bytesToHex(concat([Uint8Array.of(0x06), rlpEncode(it)]));
  const sig = (signer: Uint8Array) => [[e("0x01"), signer, new Uint8Array(), new Uint8Array(65)]];
  const withMode = (m: number) => {
    const it = items();
    (it[4] as RlpItem[][])[0]![0] = Uint8Array.of(m);
    return tx(it);
  };
  it("baseline with 20-byte target and signer decodes", () => {
    expect(() => parseFrameTx(tx(items(new Uint8Array(20), sig(new Uint8Array(20)))))).not.toThrow();
  });
  const cases: [string, Hex][] = [
    ["19-byte target", tx(items(new Uint8Array(19)))],
    ["21-byte target", tx(items(new Uint8Array(21)))],
    ["19-byte signer", tx(items(undefined, sig(new Uint8Array(19))))],
    ["21-byte signer", tx(items(undefined, sig(new Uint8Array(21))))],
    ["mode 3", withMode(3)],
    ["mode 4", withMode(4)],
    // 0xb8 0x05 + 5 bytes: long-form string header for a 5-byte string
    ["long-form string of length <= 55", bytesToHex(Uint8Array.of(0x06, 0xc7, 0xb8, 0x05, 1, 2, 3, 4, 5))],
    // list says 2 bytes of payload, its item claims 3
    ["list item overrunning its list", bytesToHex(Uint8Array.of(0x06, 0xc2, 0x83, 0x01, 0x02, 0x03))],
  ];
  it.each(cases)("rejects: %s", (_n, input) => {
    expect(() => parseFrameTx(input)).toThrow(FrameTxDecodeError);
  });
  it("messages name the cause", () => {
    expect(() => parseFrameTx(cases[0]![1])).toThrow(/target: expected 0 or 20 bytes, got 19/);
    expect(() => parseFrameTx(cases[3]![1])).toThrow(/signer: expected 0 or 20 bytes, got 21/);
    expect(() => parseFrameTx(cases[5]![1])).toThrow(/unsupported frame mode 4/);
    expect(() => parseFrameTx(cases[6]![1])).toThrow(/long-form length used for a length <= 55/);
    expect(() => parseFrameTx(cases[7]![1])).toThrow(/list item overruns its list/);
  });
});

// ---------------------------------------------------------------- #10 #11 signing

describe("#10/#11 signing", () => {
  const base: FrameTx = { ...parseFrameTx(SPEC_VECTORS[1]!.raw), signatures: [arbitraryEntry()] };
  const N_HALF = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
  const recover = (tx: FrameTx, i: number) => {
    const b = hexToBytes(tx.signatures[i]!.signature);
    return recoverAddress({ hash: signatureHash(tx), signature: concat([bytesToHex(b.subarray(1, 33)), bytesToHex(b.subarray(33, 65)), b[0] === 0 ? "0x1b" : "0x1c"]) });
  };

  it("100 random keys: 65 bytes, v byte in {0,1} (both seen), low s, recovers to the signer", async () => {
    const vs = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const acct = privateKeyToAccount(generatePrivateKey());
      const t = await signSecp256k1Entry({ ...base, nonceSeq: BigInt(i) }, 1, acct);
      const b = hexToBytes(t.signatures[1]!.signature);
      expect(b.length).toBe(65);
      expect(b[0]! <= 1).toBe(true);
      vs.add(b[0]!);
      expect(BigInt(toHex(b.subarray(33))) <= N_HALF).toBe(true);
      expect(await recover(t, 1)).toBe(acct.address);
    }
    expect([...vs].sort()).toEqual([0, 1]);
  });

  it("explicitSigner: false leaves signer empty (= tx.sender) and still recovers to the account", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const t = await signSecp256k1Entry({ ...base, sender: acct.address.toLowerCase() as Hex, signatures: [] }, 0, acct, { explicitSigner: false });
    expect(t.signatures[0]).toMatchObject({ scheme: SignatureScheme.SECP256K1, signer: null, msg: "0x" });
    expect(await recover(t, 0)).toBe(acct.address);
    expect(validateFrameTx(t)).toEqual([]);
  });

  it("other entries with a non-empty msg are covered: changing their bytes after signing changes the hash", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const withMsg: FrameTx = { ...base, signatures: [{ scheme: SignatureScheme.P256, signer: null, msg: `0x${"77".repeat(32)}`, signature: `0x${"aa".repeat(128)}` }] };
    const t = await signSecp256k1Entry(withMsg, 1, acct);
    expect(await recover(t, 1)).toBe(acct.address);
    const tampered: FrameTx = { ...t, signatures: [{ ...t.signatures[0]!, signature: `0x${"bb".repeat(128)}` }, t.signatures[1]!] };
    expect(signatureHash(tampered)).not.toBe(signatureHash(t));
    expect(await recover(tampered, 1)).not.toBe(acct.address);
  });
});
