// Measures the validation-gas limit an endpoint enforces, without sending anything that can be admitted.
// Each probe is an unsigned frame transaction from a random address with no code: the endpoint checks the validation
// budget first, so "exceeds MAX_VERIFY_GAS" means the limit is below the probe, while any other rejection (for example
// "the frame's default code reported failure") means the budget check passed.
//   bun packages/sdk/scripts/probe-limits.ts [rpc-url] [sidecar-url]
import { FrameFlags, FrameMode, toSidecarWire, type FrameTx } from "../src/index.ts";

const rpc = process.argv[2] ?? "https://altmempool.forshtat.com/rpc";
const call = async (url: string, method: string, params: unknown[]) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }, (_k, v) => (typeof v === "bigint" ? "0x" + v.toString(16) : v)) });
  return (await r.json()) as { result?: unknown; error?: { message: string; code: number } };
};
const sender = ("0x" + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
const chainId = BigInt(((await call(rpc.replace(/\/rpc$/, ""), "eth_chainId", [])).result as string) ?? "0x539");

console.log("endpoint", rpc, "chain", chainId);
for (const gas of [90_000n, 100_001n, 250_001n, 1_000_001n, 2_500_001n, 10_000_000n]) {
  const tx: FrameTx = {
    chainId,
    nonceKeys: [0n],
    nonceSeq: 0n,
    sender,
    frames: [
      { mode: FrameMode.VERIFY, flags: FrameFlags.APPROVE_EXECUTION_AND_PAYMENT, target: null, gasLimit: gas, stateGasLimit: 0n, value: 0n, data: "0x" },
      { mode: FrameMode.SENDER, flags: FrameFlags.NONE, target: "0x000000000000000000000000000000000000dEaD", gasLimit: 21_000n, stateGasLimit: 0n, value: 0n, data: "0x" },
    ],
    signatures: [],
    fees: { maxPriorityFeePerGas: 1_000_000_000n, maxFeePerGas: 2_000_000_000n, maxFeePerBlobGas: 0n },
    blobHashes: [],
    recentRootReferences: [],
  };
  const r = await call(rpc, "eth_sendFrameTransaction", [toSidecarWire(tx)]);
  const msg = r.error?.message ?? JSON.stringify(r.result);
  const budget = /exceeds|MAX_VERIFY_GAS|budget/i.test(msg) ? "LIMIT HIT" : "budget ok";
  console.log(String(gas).padStart(10), budget.padEnd(10), msg.slice(0, 150));
}
