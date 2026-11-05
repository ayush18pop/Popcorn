// simulate() with the plain-English report. Offline tests always run; the network block needs a local devnet
// (POPCORN_NETWORK=1 POPCORN_DEVNET=local) and deploys one fixture rule contract per failure (contracts/src/test/SimFixtures.sol).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sendTransaction, waitForTransactionReceipt } from "viem/actions";
import { describe, expect, expectTypeOf, it } from "vitest";
import { devnetChain, popcorn, STAKING_REGISTRY, stakingRegistryOf, type SimulateResultLike } from "../src/index.ts";
import type { SimulateResult } from "../src/actions.ts";

const ROOT = new URL("../../../", import.meta.url).pathname;
const KEY_FILE = `${ROOT}devnet/keys/dev-7.json`; // written by devnet/up.sh
const WANTED = process.env.POPCORN_NETWORK === "1" && process.env.POPCORN_DEVNET === "local";
const ON = WANTED && existsSync(KEY_FILE);
if (WANTED && !ON) console.warn(`[simulate] network block SKIPPED: ${KEY_FILE} not found. Start the local devnet first (devnet/up.sh writes devnet/keys/dev-*.json; see devnet/README.md).`);
const BIN = new URL("../bin/popcorn-simulate.ts", import.meta.url).pathname;

describe("simulate() offline", () => {
  it("simulate({ at }) is an explicit error (Core rejects recent roots, 0x23)", async () => {
    const c = createPublicClient({ chain: devnetChain("local"), transport: http() }).extend(popcorn({ devnet: "local" }));
    await expect(c.simulate("0x0000000000000000000000000000000000000001", { at: new Date() })).rejects.toThrow(/not supported: Core rejects recent-root references \(code 0x23\)/);
    await expect(c.simulate("0x0000000000000000000000000000000000000001", { at: 1n })).rejects.toThrow(/not supported/);
  });

  it("the SDK's SimulateResult is a SimulateResultLike (one type) and carries report + text", () => {
    const check = (r: SimulateResult): SimulateResultLike => r;
    void check;
    expectTypeOf<SimulateResult["report"]["summary"]>().toBeString();
    expectTypeOf<SimulateResult["text"]>().toBeString();
  });

  it("the staking registry is the shared devnet address on both devnets", () => {
    expect(stakingRegistryOf("local")).toBe(STAKING_REGISTRY);
    expect(stakingRegistryOf("devnet1")).toBe(STAKING_REGISTRY);
  });

  it("CLI: usage errors exit 2 without touching the network", () => {
    const run = (...a: string[]) => spawnSync("bun", [BIN, ...a], { encoding: "utf8" });
    expect(run().status).toBe(2);
    expect(run("nope").stderr).toContain("not an address");
    expect(run("0x0000000000000000000000000000000000000001", "--devnet", "mainnet").stderr).toContain("--devnet must be local or devnet1");
    expect(run("0x0000000000000000000000000000000000000001", "--trigger-args", "zz").stderr).toContain("0x-hex");
    expect(run("--help").stderr).toContain("--sidecar-admit");
  });
});

describe.skipIf(!ON)("simulate() on the local devnet", () => {
  const art = (n: string, f: string): { bytecode: { object: Hex }; abi: unknown[] } => JSON.parse(readFileSync(`${ROOT}contracts/out/${f}.sol/${n}.json`, "utf8"));
  const key: Hex = ON ? (JSON.parse(readFileSync(KEY_FILE, "utf8")) as { private_key: Hex }[])[0]!.private_key : "0x0000000000000000000000000000000000000000000000000000000000000001";
  const chain = devnetChain("local");
  const w = createWalletClient({ account: privateKeyToAccount(key), chain, transport: http() }).extend(popcorn({ devnet: "local" }));
  const pub = createPublicClient({ chain, transport: http() });
  const k: Record<string, Address> = {};

  const mk = async (name: string, args: unknown[], o: { fund?: bigint; caps?: Record<string, number | bigint>; stake?: boolean } = {}) => {
    const a = art(name, "SimFixtures");
    return (await w.deployRule({ logic: { abi: a.abi, bytecode: a.bytecode.object, args }, fund: o.fund ?? parseEther("0.05"), allowUnderfunded: true, ...(o.caps ? { caps: o.caps } : {}), ...(o.stake ? { stake: true } : {}) })).ruleContract;
  };

  it("deploys the fixture rule contracts", async () => {
    const h = await sendTransaction(w, { data: art("MockValue", "MockValue").bytecode.object, gas: 1_000_000n } as never);
    const mv = (await waitForTransactionReceipt(pub, { hash: h })).contractAddress!;
    // Amsterdam state gas: a first SSTORE needs well over 100k gas
    await waitForTransactionReceipt(pub, { hash: await sendTransaction(w, { to: mv, data: "0x60fe47b10000000000000000000000000000000000000000000000000000000000000001", gas: 500_000n } as never) });
    k.readOther = await mk("SimReadOtherRule", [mv]);
    k.heavy = await mk("SimHeavyVerifyRule", [560], { caps: { conditionGas: 200_000 } });
    k.write = await mk("SimWriteStorageRule", []);
    k.valid = await mk("SimHeavyVerifyRule", [0]);
    k.poor = await mk("SimHeavyVerifyRule", [0], { fund: 1_000n });
    k.staked = await mk("SimStakedReadRule", [mv, parseEther("0.1")], { fund: parseEther("0.5"), stake: true, caps: { maxStateGasPerFrame: 300_000n } });
  }, 600_000);

  it("unstaked rule contract reading another contract -> stake the rule contract", async () => {
    const r = await w.simulate(k.readOther!, { triggerData: "0x01" });
    expect(r.stake).toMatchObject({ isStaked: false });
    expect(r.network).toBe("local");
    expect(r.report.publicMempool.headline).toBe("reads another contract's storage");
    expect(r.text).toContain("that read needs a stake");
    expect(r.text).toContain("Stake the rule contract");
  }, 120_000);

  it("heavy VERIFY: public NO on devnet1's budget, YES on local's; alt admits", async () => {
    const r = await w.simulate(k.heavy!, { triggerData: "0x01" });
    expect(r.ethrex.verifyGas!).toBeGreaterThan(100_000n);
    expect(r.report.publicMempool.ok).toBe(true); // local: 250k
    expect(r.report.altMempool.headline).toMatch(/^predicted: within 250,000 \(unstaked\) and no outside reads$/);
    const { explain } = await import("@popcorn/simulator");
    const d = explain(r, { network: "devnet1" });
    expect(d.publicMempool.headline).toMatch(/^validation used [\d,]+ gas, over the 100,000 budget$/);
    expect(d.summary).toBe("alt mempool only (predicted)");
  }, 120_000);

  it("condition that writes storage -> writes storage during validation (Core 0x20)", async () => {
    const r = await w.simulate(k.write!, { triggerData: "0x01" });
    expect(r.coreError?.code).toBe(0x20);
    expect(r.text).toContain("writes storage during validation");
  }, 120_000);

  it("rule contract funded below maxCost -> balance can't cover the worst-case trigger", async () => {
    const r = await w.simulate(k.poor!, { triggerData: "0x01" });
    expect(r.ruleContractBalance).toBe(1_000n);
    expect(r.text).toContain("balance can't cover the worst-case trigger");
    expect(r.report.findings).toHaveLength(1);
  }, 120_000);

  it("valid rule contract -> admitted by ERC-8421 and a public YES", async () => {
    const r = await w.simulate(k.valid!, { triggerData: "0x01", sidecar: true }); // the only test that submits to the sidecar
    expect(r.text).toContain("admitted by ERC-8421");
    expect(r.text).toContain("SUBMITTED this trigger");
    expect(r.report.summary).toBe("accepted by both mempools");
  }, 120_000);

  it("staked rule contract reading another contract -> alt YES, public NO", async () => {
    const r = await w.simulate(k.staked!, { triggerData: "0x01" });
    expect(r.stake?.isStaked).toBe(true);
    expect(r.report.altMempool).toMatchObject({ ok: true, predicted: true });
    expect(r.report.publicMempool.ok).toBe(false);
  }, 120_000);

  it("default simulate() and canTrigger() never reach the sidecar: the trigger is not included", async () => {
    const before = await pub.getTransactionCount({ address: k.valid! });
    const r = await w.simulate(k.valid!, { triggerData: "0xfe" });
    await w.canTrigger(k.valid!, { triggerData: "0xfe" });
    expect(r.sidecar).toBeNull();
    expect(r.text).not.toContain("SUBMITTED");
    await new Promise((res) => setTimeout(res, 15_000)); // > 2 slots
    const again = await w.simulate(k.valid!, { triggerData: "0xfe" });
    expect(again.ethrex.error ?? "").not.toMatch(/Nonce mismatch/); // still unused
    expect(again.report.publicMempool.ok).toBe(true);
    void before;
  }, 120_000);

  it("CLI prints the report and exits 1 on a rejection, 0 on acceptance", () => {
    const run = (a: string, pa = "0xc1") => spawnSync("bun", [BIN, a, "--devnet", "local", "--trigger-args", pa], { encoding: "utf8" });
    const ok = run(k.valid!);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("predicted: within 250,000");
    expect(ok.stderr).not.toContain("WARNING");
    const adm = spawnSync("bun", [BIN, k.valid!, "--devnet", "local", "--trigger-args", "0xc2", "--sidecar-admit"], { encoding: "utf8" });
    expect(adm.stdout).toContain("admitted by ERC-8421");
    expect(adm.stderr).toContain("WARNING: --sidecar-admit submitted this trigger");
    const bad = run(k.poor!);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("balance can't cover the worst-case trigger");
    const js = spawnSync("bun", [BIN, k.valid!, "--devnet", "local", "--trigger-args", "0xc3", "--json"], { encoding: "utf8" });
    expect(JSON.parse(js.stdout).report.summary).toBe("accepted by both mempools (alt mempool predicted)");
  }, 180_000);
});
