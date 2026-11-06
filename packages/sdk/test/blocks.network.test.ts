// Blocks without Solidity, end to end on the local devnet: a build made only of SDK blocks (Value Crosses A Line, None Of,
// Pause The Target on another contract) is published on the shared rule-set engine, staked, and triggered by a frame
// transaction from an account with no ETH. Skipped unless POPCORN_NETWORK=1 and the local devnet answers.
//   POPCORN_NETWORK=1 bun run --cwd packages/sdk vitest run test/blocks.network.test.ts
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sendTransaction, waitForTransactionReceipt } from "viem/actions";
import { describe, expect, it } from "vitest";
import { blocks, deployRuleSet, devnetChain, popcorn } from "../src/index.ts";
import { triggerDataFor } from "../src/ruleset/witness.ts";

const ROOT = new URL("../../../", import.meta.url).pathname;
const KEYS = `${ROOT}devnet/keys`;
const WANTED = process.env.POPCORN_NETWORK === "1";
const chain = devnetChain("local");

async function chainUp(): Promise<boolean> {
  try {
    const r = await fetch("http://127.0.0.1:18545", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }), signal: AbortSignal.timeout(3000) });
    return (await r.json()).result === "0x53a";
  } catch {
    return false;
  }
}
const ON = WANTED && existsSync(`${KEYS}/dev-5.json`) && (await chainUp());
const art = (n: string): { bytecode: { object: Hex }; abi: readonly unknown[] } => JSON.parse(readFileSync(`${ROOT}contracts/out/${n}.sol/${n}.json`, "utf8"));
const key = (n: number): Hex => (JSON.parse(readFileSync(`${KEYS}/dev-${n}.json`, "utf8")) as { private_key: Hex }[])[0]!.private_key;

describe.skipIf(!ON)("blocks without Solidity on the local devnet", () => {
  it("Value Crosses A Line + None Of -> Pause The Target, sent by a key with no ETH", async () => {
    const owner = createWalletClient({ account: privateKeyToAccount(key(5)), chain, transport: http() }).extend(popcorn({ devnet: "local" }));
    const pub = createPublicClient({ chain, transport: http() });
    const deploy = async (name: string) => {
      const h = await sendTransaction(owner, { data: art(name).bytecode.object, gas: 3_000_000n } as never);
      return (await waitForTransactionReceipt(pub, { hash: h })).contractAddress!;
    };
    const write = async (address: Address, name: string, fn: string, args: unknown[]) => {
      const h = await owner.writeContract({ address, abi: art(name).abi as never, functionName: fn, args: args as never, gas: 300_000n } as never);
      expect((await waitForTransactionReceipt(pub, { hash: h })).status).toBe("success");
    };
    const read = (address: Address, name: string, fn: string) => pub.readContract({ address, abi: art(name).abi as never, functionName: fn } as never);

    const gauge = await deploy("MockValue");
    const target = await deploy("MockPausable");

    const { getter, build, allOf, noneOf, valueCrossesLine, pauseTarget } = blocks;
    const spec = build({
      name: "pause when the gauge goes over 100",
      when: allOf(valueCrossesLine(getter(gauge, "value()"), "above", 100n), noneOf(valueCrossesLine(getter(target, "paused()"), "above", 0n))),
      then: pauseTarget(target),
    });
    const { ruleContract } = await deployRuleSet(owner.popcorn, spec, { fund: parseEther("0.3"), stake: true });
    await write(target, "MockPausable", "setPauser", [ruleContract]);

    const stranger = createWalletClient({ account: privateKeyToAccount(generatePrivateKey()), chain, transport: http() }).extend(popcorn({ devnet: "local" }));
    await write(gauge, "MockValue", "set", [50n]);
    expect((await stranger.canTrigger(ruleContract, { triggerData: triggerDataFor(0) })).name).toBe("CONDITION_FALSE");

    await write(gauge, "MockValue", "set", [150n]);
    const hash = await stranger.trigger(ruleContract, { triggerData: triggerDataFor(0) });
    const done = await stranger.watch(hash, { timeoutMs: 150_000 });
    expect(done.state).toBe("included");
    expect(await read(target, "MockPausable", "paused")).toBe(true);
    // the rule fires once, and None Of (already paused) would refuse it anyway
    expect((await stranger.canTrigger(ruleContract, { triggerData: triggerDataFor(0) })).name).not.toBe("READY");
  }, 600_000);
});
