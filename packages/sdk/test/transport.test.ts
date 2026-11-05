// Offline tests for transport + watch: fetch is stubbed with a tiny fake of each endpoint.
import { getAddress, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFrameTx, txHash } from "../src/encoder.ts";
import { GatewayUnavailable, RpcError, WatchTimeout } from "../src/errors.ts";
import { checkGateway, devnets, isGatewayUp, sendFrameTransaction, simulateFrameTransaction, toSidecarWire } from "../src/transport.ts";
import { watch, type WatchStatus } from "../src/watch.ts";
import { SPEC_VECTORS } from "./fixtures/spec-vectors.ts";

const d = devnets.devnet1;
type Handler = (method: string, params: unknown[]) => { status?: number; body?: string; result?: unknown; error?: { code: number; message: string } };
const calls: { url: string; method: string; params: unknown[] }[] = [];

function stub(handlers: Record<string, Handler>) {
  calls.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const { method, params, id } = JSON.parse(String(init.body));
    calls.push({ url, method, params });
    const h = handlers[url];
    if (!h) throw new TypeError(`fetch failed (no stub for ${url})`);
    const r = h(method, params);
    if (r.status && r.status !== 200) return new Response(r.body ?? "", { status: r.status });
    return new Response(JSON.stringify(r.error ? { jsonrpc: "2.0", id, error: r.error } : { jsonrpc: "2.0", id, result: r.result ?? null }), { status: 200 });
  });
}
afterEach(() => vi.unstubAllGlobals());

const raw = SPEC_VECTORS[1]!.raw; // EOA-payer vector
const hash = SPEC_VECTORS[1]!.txHash;
const bad502: Handler = () => ({ status: 502, body: "<html>502 Bad Gateway</html>" });

describe("devnets", () => {
  it("devnet1 is chain 1337 with all four URLs", () => {
    expect(d).toMatchObject({ chainId: 1337, rpcUrl: expect.stringMatching(/^https:/), gatewayUrl: expect.stringMatching(/\/rpc$/), sidecarUrl: expect.any(String), explorerUrl: expect.any(String) });
  });
});

describe("gateway health", () => {
  it("throws GatewayUnavailable with the HTTP status on 502", async () => {
    stub({ [d.gatewayUrl]: bad502 });
    const e = await checkGateway().catch((x) => x);
    expect(e).toBeInstanceOf(GatewayUnavailable);
    expect(e.status).toBe(502);
    expect(e.message).toMatch(/HTTP 502/);
    expect(await isGatewayUp()).toBe(false);
  });
  it("throws GatewayUnavailable when unreachable", async () => {
    stub({});
    await expect(checkGateway()).rejects.toBeInstanceOf(GatewayUnavailable);
  });
  it("rejects a wrong chain id", async () => {
    stub({ [d.gatewayUrl]: () => ({ result: "0x1" }) });
    await expect(checkGateway()).rejects.toThrow(/wrong chain id 1/);
  });
  it("passes when eth_chainId = 0x539", async () => {
    stub({ [d.gatewayUrl]: () => ({ result: "0x539" }) });
    expect(await checkGateway()).toEqual({ url: d.gatewayUrl, chainId: 1337 });
  });
});

describe("sendFrameTransaction", () => {
  it("rpc: eth_sendRawTransaction(raw)", async () => {
    stub({ [d.rpcUrl]: () => ({ result: hash }) });
    expect(await sendFrameTransaction(raw, { via: "rpc" })).toBe(hash);
    expect(calls).toEqual([{ url: d.rpcUrl, method: "eth_sendRawTransaction", params: [raw] }]);
  });
  it("sidecar: eth_sendFrameTransaction(wire tx)", async () => {
    stub({ [d.sidecarUrl]: () => ({ result: hash }) });
    expect(await sendFrameTransaction(raw, { via: "sidecar" })).toBe(hash);
    expect(calls[0]!.method).toBe("eth_sendFrameTransaction");
    const wire = calls[0]!.params[0] as Record<string, any>;
    expect(wire).toEqual(toSidecarWire(parseFrameTx(raw)));
    expect(wire.frames[1]).toEqual({ mode: 1, flags: 1, target: "0xebe14f3b5c632a3b8d680978744c2206e830d368", limits: { execution: "0x9c40", state: "0x0" }, value: "0x0", data: "0x" });
    expect(wire.signatures[0]).toEqual({ scheme: 0, signer: "0x", msg: "0x", signature: "0x" });
    expect(wire.nonceKeys).toEqual(["0x7d4"]);
  });
  it("gateway: 502 -> GatewayUnavailable", async () => {
    stub({ [d.gatewayUrl]: bad502 });
    await expect(sendFrameTransaction(raw, { via: "gateway" })).rejects.toBeInstanceOf(GatewayUnavailable);
  });
  it("JSON-RPC error -> RpcError with code and message", async () => {
    stub({ [d.rpcUrl]: () => ({ error: { code: -32000, message: "Invalid params: Frame transaction prefix gas budget (frames + sig cost) exceeds MAX_VERIFY_GAS" } }) });
    const e = await sendFrameTransaction(raw, { via: "rpc" }).catch((x) => x);
    expect(e).toBeInstanceOf(RpcError);
    expect(e.code).toBe(-32000);
    expect(e.rpcMessage).toMatch(/MAX_VERIFY_GAS/);
  });
  it("throws when the endpoint's hash is not keccak256(raw)", async () => {
    stub({ [d.rpcUrl]: () => ({ result: `0x${"00".repeat(32)}` }) });
    await expect(sendFrameTransaction(raw, { via: "rpc" })).rejects.toThrow(/expected keccak256/);
  });
});

describe("simulateFrameTransaction", () => {
  it("parses a valid result (shape from core/experiments/log.jsonl)", async () => {
    stub({
      [d.rpcUrl]: (m, p) => {
        expect(m).toBe("ethrex_simulateFrameTransaction");
        expect(p).toEqual([raw, "latest", { trace: true }]);
        return {
          result: {
            canonicalMempoolValid: true, canonicalMempoolViolation: null, erc7562Trace: { calls: [] }, erc7562TraceError: null, executionError: null,
            executionStatus: "success", frames: [{ gasUsed: "0x670a", succeeded: true }, { gasUsed: "0xdefd", succeeded: true }], gasUsed: "0x21df0",
            maxCost: "0x2cb3739654800", payer: "0xb3e29c868351ea79e9e66a028ffca365d47054bf", prefixShape: "SelfVerify",
          },
        };
      },
    });
    const s = await simulateFrameTransaction(raw);
    expect(s).toMatchObject({ executionStatus: "success", canonicalMempoolValid: true, prefixShape: "SelfVerify", gasUsed: 0x21df0n, maxCost: 0x2cb3739654800n, payer: getAddress("0xb3e29c868351ea79e9e66a028ffca365d47054bf") });
    expect(s.frames).toEqual([{ gasUsed: 26378n, succeeded: true }, { gasUsed: 57085n, succeeded: true }]);
  });
  it("parses an invalid result", async () => {
    stub({
      [d.rpcUrl]: () => ({
        result: {
          canonicalMempoolValid: false, canonicalMempoolViolation: "validation prefix frame reverted", executionError: "Invalid Transaction: ... VERIFY frame 0 ... failed: RevertOpcode",
          executionStatus: null, failedFrameIndex: 0, frames: null, gasUsed: null, haltDetail: "the frame reverted", haltReason: "revert", maxCost: "0xd73a7fab2e800", payer: null, prefixShape: "SelfVerify",
          revertData: "0x0000000000000000000000000000000000000000000000000000000000000008",
        },
      }),
    });
    const s = await simulateFrameTransaction(raw);
    expect(s).toMatchObject({ executionStatus: null, failedFrameIndex: 0, haltReason: "revert", frames: null, gasUsed: null, payer: null });
    expect(s.executionError).toMatch(/RevertOpcode/);
  });
});

const receipt = {
  blockHash: "0xcb2eafa48ad93d058218e1fade680355155c62bc6bce4c59d87cd3bc99658fb6", blockNumber: "0x4af5e", effectiveGasPrice: "0x3b9aca07",
  frameReceipts: [{ gasUsed: "0x670a", logs: [], stateGasUsed: "0x0", status: "0x1" }, { gasUsed: "0xdefd", logs: [], stateGasUsed: "0x47b80", status: "0x1" }],
  from: "0xb3e29c868351ea79e9e66a028ffca365d47054bf", gasUsed: "0x5f511", payer: "0xb3e29c868351ea79e9e66a028ffca365d47054bf", status: "0x1", transactionHash: hash, type: "0x6",
};

describe("watch", () => {
  it("waiting -> admitted (gateway) -> included", async () => {
    let n = 0;
    stub({
      [d.rpcUrl]: (m) => {
        if (m === "eth_getTransactionReceipt") return { result: n >= 3 ? receipt : null };
        return { result: null };
      },
      [d.gatewayUrl]: (m) => {
        if (m === "skandha_explorer_getTransaction") {
          n++;
          return n <= 1 ? { error: { code: -32602, message: "Frame transaction not found" } } : { result: { entry: { status: "New" }, admission: { outcome: "accepted", checks: [] }, events: [] } };
        }
        return { error: { code: -32601, message: "no" } };
      },
    });
    const seen: WatchStatus[] = [];
    const s = await watch(hash, { intervalMs: 1, onStatus: (x) => seen.push(x) });
    expect(seen.map((x) => x.state)).toEqual(["waiting", "admitted", "included"]);
    expect(seen[1]).toEqual({ state: "admitted", by: ["gateway"], unavailable: [] });
    expect(s).toMatchObject({ state: "included", blockNumber: 0x4af5en, status: "success", gasUsed: 0x5f511n });
    if (s.state === "included") expect(s.receipt.frameReceipts[1]!.stateGasUsed).toBe(293760n);
  });

  it("gateway down: reports from the node only", async () => {
    let n = 0;
    stub({
      [d.gatewayUrl]: bad502,
      [d.rpcUrl]: (m) => {
        if (m === "eth_getTransactionReceipt") return { result: n >= 2 ? receipt : null };
        n++;
        return { result: { hash, blockNumber: null } };
      },
    });
    const seen: WatchStatus[] = [];
    const s = await watch(hash, { intervalMs: 1, onStatus: (x) => seen.push(x) });
    expect(seen[0]).toEqual({ state: "admitted", by: ["node"], unavailable: ["gateway"] });
    expect(s.state).toBe("included");
  });

  it("dropped with the sidecar's rejection reason", async () => {
    stub({
      [d.rpcUrl]: () => ({ result: null }),
      [d.sidecarUrl]: () => ({ result: { entry: null, admission: { outcome: "rejected", errorCode: -32502, checks: [{ rule: "storage", verdict: "fail", detail: "unstaked payer accessed 0x9ee8 slot 0x1" }] }, events: [] } }),
    });
    const s = await watch(hash, { intervalMs: 1, mempools: ["sidecar"] });
    expect(s).toEqual({ state: "dropped", by: "sidecar", reason: "rejected: storage: unstaked payer accessed 0x9ee8 slot 0x1" });
  });

  it("falls back to skandha_frameTransactionStatus when the explorer is disabled", async () => {
    stub({
      [d.rpcUrl]: () => ({ result: null }),
      [d.sidecarUrl]: (m) => (m === "skandha_explorer_getTransaction" ? { error: { code: -32601, message: "Explorer is disabled: start the node with --explorer.enable" } } : { result: { status: "Cancelled", reason: "evicted" } }),
    });
    expect(await watch(hash, { intervalMs: 1, mempools: ["sidecar"] })).toEqual({ state: "dropped", by: "sidecar", reason: "dropped: evicted" });
  });

  it("dropped after the node loses a pending tx", async () => {
    let n = 0;
    stub({ [d.rpcUrl]: (m) => (m === "eth_getTransactionByHash" && n++ < 2 ? { result: { hash, blockNumber: null } } : { result: null }) });
    const s = await watch(hash, { intervalMs: 1, missingPollsBeforeDropped: 3, mempools: [] });
    expect(s).toMatchObject({ state: "dropped", by: "node" });
  });

  it("times out with the last status", async () => {
    stub({ [d.rpcUrl]: () => ({ result: null }), [d.gatewayUrl]: bad502 });
    const e = await watch(hash as Hex, { intervalMs: 5, timeoutMs: 30 }).catch((x) => x);
    expect(e).toBeInstanceOf(WatchTimeout);
    expect(e.last).toEqual({ state: "waiting", unavailable: ["gateway"] });
  });
});

it("fixture hash is keccak(raw)", () => expect(txHash(raw)).toBe(hash));
