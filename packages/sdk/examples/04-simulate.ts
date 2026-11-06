// simulate(): would this trigger be accepted, by the public mempool and by the alt mempool? Plain English, nothing sent.
//   POPCORN_DEVNET=local bun packages/sdk/examples/04-simulate.ts <rule contract>
import { createPublicClient, getAddress, http } from "viem";
import { popcorn, toJSON } from "@popcorn/sdk";
import { chain, devnet } from "./_common.ts";

const ruleContract = getAddress(process.argv[2] ?? (() => { throw new Error("usage: 04-simulate.ts <rule contract address>"); })());
const client = createPublicClient({ chain, transport: http() }).extend(popcorn({ devnet })); // sidecar: false (default) = never submits

const r = await client.simulate(ruleContract);
console.log(r.text); // the report the CLI prints: both mempools, with a fix per problem
console.log("public mempool:", r.report.publicMempool.ok, "| alt mempool:", r.report.altMempool.ok, "(null = unknown, `predicted` = not asked)");
console.log(JSON.stringify(toJSON(r.report)).length, "bytes of JSON for tooling");
