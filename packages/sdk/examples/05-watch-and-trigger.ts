// A keeper-free "bot": poll canTrigger() every few seconds and trigger the moment the condition is true. Anyone can run this.
//   POPCORN_DEVNET=local bun packages/sdk/examples/05-watch-and-trigger.ts <rule contract> [maxSeconds]
import { createPublicClient, getAddress, http } from "viem";
import { RuleContractNotReady, popcorn } from "@popcorn/sdk";
import { chain, devnet } from "./_common.ts";

const ruleContract = getAddress(process.argv[2] ?? (() => { throw new Error("usage: 05-watch-and-trigger.ts <rule contract address> [maxSeconds]"); })());
const deadline = Date.now() + Number(process.argv[3] ?? 120) * 1000;
const client = createPublicClient({ chain, transport: http() }).extend(popcorn({ devnet }));

while (Date.now() < deadline) {
  const r = await client.canTrigger(ruleContract);
  if (r.ready) {
    try {
      const hash = await client.trigger(ruleContract); // re-simulates; throws RuleContractNotReady (nothing sent) if someone else got there first
      const done = await client.watch(hash, { timeoutMs: 120_000 });
      console.log("triggered", hash, done.state, client.explorerUrl(hash));
      break;
    } catch (e) {
      if (!(e instanceof RuleContractNotReady)) throw e;
    }
  } else {
    console.log(`not ready: ${r.name} (${r.reason})`);
  }
  await new Promise((res) => setTimeout(res, 3_000));
}
