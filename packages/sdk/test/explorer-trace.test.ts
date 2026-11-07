import { afterEach, describe, expect, it, vi } from "vitest";
import { contractRelations, memberships, neighbors, type TraceContext, type TraceStep } from "../../../apps/web/src/lib/trace-model";
import { inspectTransaction } from "../src/inspect.ts";
const hash = `0x${"ab".repeat(32)}` as const;
const otherHash = `0x${"cd".repeat(32)}` as const;
const address = "0x00000000000000000000000000000000000b0001" as const;
const step = (tx = hash, ordered = true): TraceStep => ({ tx, title: "deposit", detail: "funds the vault", role: "deposit", kind: "ordinary", outcome: "success", block: 1, ordered, blockIds: [] });
const context = (id: string, network: "local" | "devnet1", steps = [step()]): TraceContext => ({ id, network, chainId: network === "local" ? 1338 : 1337, title: id, summary: "recorded sequence", kind: "incident", contracts: { vault: address }, steps, source: "record.json" });
afterEach(() => vi.unstubAllGlobals());
describe("transaction trace relationships", () => {
  it("keeps memberships scoped to the network, even when hashes coincide", () => {
    const contexts = [context("local-example", "local"), context("public-incident", "devnet1")];
    expect(memberships(contexts, hash, "devnet1").map((m) => m.context.id)).toEqual(["public-incident"]);
    expect(memberships(contexts, hash.toUpperCase())).toHaveLength(2);
  });
  it("retains every documented membership when a step participates in two stories", () => {
    expect(memberships([context("first", "local"), context("second", "local")], hash, "local")).toHaveLength(2);
  });
  it("does not invent chronological edges for refused attempts with no recorded position", () => {
    const first = step(); const refusal = step(otherHash as typeof hash, false); const last = step(`0x${"ef".repeat(32)}` as typeof hash);
    const c = context("case", "local", [first, refusal, last]);
    expect(neighbors(c, first).next).toBe(last);
    expect(neighbors(c, refusal)).toEqual({});
    expect(neighbors(c, last).previous).toBe(first);
  });
  it("separates shared-contract relationships from recorded membership", () => {
    const c = context("case", "devnet1");
    const inspection = { hash: otherHash, build: address };
    expect(memberships([c], otherHash, "devnet1")).toHaveLength(0);
    expect(contractRelations([c], inspection, "devnet1")).toEqual([c]);
    expect(contractRelations([c], inspection, "local")).toEqual([]);
  });
});
describe("ordinary transaction inspection", () => {
  it("does not label an unrelated frame transaction as a Popcorn build", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const { method, id } = JSON.parse(String(init.body));
      const result = method === "eth_getTransactionByHash" ? { type: "0x6", sender: address, blockNumber: "0x1", frames: [{ mode: 1, flags: 3, target: null, data: "0x" }, { mode: 2, flags: 0, target: null, data: "0x1234" }] }
        : method === "eth_getTransactionReceipt" ? { transactionHash: hash, blockNumber: "0x1", status: "0x1", gasUsed: "0x5208", frameReceipts: [] } : null;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200 });
    });
    const inspected = await inspectTransaction(hash, { devnet: "devnet1" });
    expect(inspected.status).toBe("included");
    expect(inspected.stages.some((stage) => stage.id === "core" || stage.id === "build")).toBe(false);
    expect(inspected.flow).toBeNull();
  });

  it("reports an ordinary reverted call without claiming Core or a condition passed", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const { method, id } = JSON.parse(String(init.body));
      const result = method === "eth_getTransactionByHash" ? { type: "0x2", from: address, to: address, value: "0x0", input: "0x12345678", blockNumber: "0x1" }
        : method === "eth_getTransactionReceipt" ? { transactionHash: hash, blockNumber: "0x1", status: "0x0", gasUsed: "0x5208", frameReceipts: [] } : null;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200 });
    });
    const inspected = await inspectTransaction(hash, { devnet: "devnet1" });
    expect(inspected.status).toBe("action-reverted");
    expect(inspected.transaction?.from.toLowerCase()).toBe(address);
    expect(inspected.build).toBeNull();
    expect(inspected.stages.map((s) => s.id)).toEqual(["chain"]);
    expect(inspected.flow).toBeNull();
  });
});
