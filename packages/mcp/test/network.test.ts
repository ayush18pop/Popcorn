// The MCP server's devnet tools against the local devnet: it simulates and builds; the test, not the server, sends.
//   POPCORN_NETWORK=1 bun test test/network.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { devnetChain, popcorn } from "@popcorn/sdk";
import { ROOT, createServer } from "../src/server.ts";

const KEY = `${ROOT}devnet/keys/dev-5.json`;
const ON = process.env.POPCORN_NETWORK === "1" && existsSync(KEY);
const chain = devnetChain("local");

describe.skipIf(!ON)("popcorn MCP server on the local devnet", () => {
  test("can_trigger refuses before arming; build_trigger's raw transaction, sent by the test, is included", async () => {
    const account = privateKeyToAccount((JSON.parse(readFileSync(KEY, "utf8")) as { private_key: Hex }[])[0]!.private_key);
    const pub = createPublicClient({ chain, transport: http() });
    const wallet = createWalletClient({ account, chain, transport: http() }).extend(popcorn({ devnet: "local" }));
    const art = JSON.parse(readFileSync(`${ROOT}contracts/out/ArmedCounter.sol/ArmedCounter.json`, "utf8"));
    const { ruleContract } = await wallet.deployRule({ logic: { abi: art.abi, bytecode: art.bytecode.object }, fund: parseEther("0.5") });

    const [a, b] = InMemoryTransport.createLinkedPair();
    await createServer().connect(a);
    const c = new Client({ name: "test", version: "0" });
    await c.connect(b);
    const call = async (name: string, args: Record<string, unknown>) => JSON.parse(((await c.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0]!.text);

    const info = await call("rule_contract_info", { network: "local", ruleContract });
    expect(info.args.mode).toBe(0);
    const before = await call("can_trigger", { network: "local", ruleContract });
    expect(before.ok ?? before.valid ?? before.readiness?.ready ?? false).toBe(false);

    const h = await wallet.writeContract({ address: ruleContract, abi: art.abi, functionName: "arm", gas: 300_000n });
    await pub.waitForTransactionReceipt({ hash: h });
    const built = await call("build_trigger", { network: "local", ruleContract });
    expect(built.ready).toBe(true);
    expect(built.needsSignature).toBe(false);
    expect(built.frames.map((f: { mode: string }) => f.mode)).toEqual(["VERIFY", "SENDER"]);
    const sent = await fetch("http://127.0.0.1:14338/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [built.raw] }) }).then((r) => r.json());
    expect(sent.error).toBeUndefined();
    const r = await pub.waitForTransactionReceipt({ hash: built.hash as Hex, timeout: 180_000 });
    expect(r.status).toBe("success");
    expect(await pub.readContract({ address: ruleContract, abi: art.abi, functionName: "count" })).toBe(1n);
  }, 600_000);
});
