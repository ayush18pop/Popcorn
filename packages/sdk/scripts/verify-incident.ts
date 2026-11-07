// Re-check a saved demo against public chain receipts. No key, signing or sending.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, keccak256 } from "viem";
import { devnetChain } from "../src/actions.ts";
import type { Incident } from "../src/incident.ts";
import { inspectTransaction } from "../src/inspect.ts";
const path = resolve(process.argv[2] ?? "examples/incidents/simple-exploit-devnet1.json");
const incident = JSON.parse(readFileSync(path, "utf8")) as Incident;
if (!incident.complete) throw new Error("Incident is incomplete: the rehearsal did not pass");
const client = createPublicClient({ chain: devnetChain(incident.network), transport: http() });
if (await client.getChainId() !== incident.chainId) throw new Error("Wrong chain");
if (new Set(incident.steps.map((s) => s.tx.toLowerCase())).size !== incident.steps.length) throw new Error("Duplicate transaction hashes");
for (const step of incident.steps) {
  if (step.outcome === "refused") {
    if (!step.raw || keccak256(step.raw).toLowerCase() !== step.tx.toLowerCase()) throw new Error(`Refused transaction bytes do not match hash: ${step.title}`);
    if (step.block !== null || step.inspection?.status !== "refused" || step.inspection.refusal?.code !== 0x22) throw new Error(`No recorded condition refusal: ${step.title}`);
    const onChain = await client.getTransactionReceipt({ hash: step.tx }).catch((e) => {
      if (e.name === "TransactionReceiptNotFoundError") return null;
      throw e;
    });
    if (onChain) throw new Error(`Refused attempt was included later: ${step.tx}`);
    console.log(`PASS ${step.title}: saved sidecar refusal; no chain receipt`);
  } else {
    const r = await client.getTransactionReceipt({ hash: step.tx });
    if (r.status !== step.outcome || Number(r.blockNumber) !== step.block) throw new Error(`Receipt mismatch: ${step.title}`);
    if (step.kind === "trigger") {
      const inspected = await inspectTransaction(step.tx, { devnet: incident.network });
      if (inspected.status !== "included" || inspected.build?.toLowerCase() !== incident.contracts.build.toLowerCase()) throw new Error("Trigger identity or inclusion mismatch");
    }
    console.log(`PASS ${step.title}: ${r.status} at block ${r.blockNumber}`);
  }
}
console.log("PASS: all incident transaction hashes and outcomes verified. Saved state snapshots remain recorded observations, not a fresh historical replay.");
