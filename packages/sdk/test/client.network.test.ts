// Client network tests (public devnet, devnet1). Skipped unless POPCORN_NETWORK=1.
//   POPCORN_NETWORK=1 vitest run test/client.network.test.ts --reporter verbose
// Keys (git-ignored, `[{address, private_key}]`): POPCORN_KEY (default keys/deployer.json) deploys and funds;
// POPCORN_ZERO_KEY (default keys/zero.json, 0 ETH) triggers. Each run spends ~0.04 ETH (logic deploys + rule contract funds).
// Results: test/results/client.json.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, parseEther, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_CORE,
  FeeAboveCap,
  InsufficientRuleContractBalance,
  RuleContractNotReady,
  checkRuleContractArgsLocal,
  defaultRuleContractArgs,
  deployments,
  deriveNonceKey,
  devnetChain,
  isGatewayUp,
  maxCostPerTrigger,
  popcorn,
  ruleFactoryAbi,
  verifyFloorAtCaps,
  type RuleContractArgs,
} from "../src/index.ts";
import { prng } from "./random.ts";

const WANTED = process.env.POPCORN_NETWORK === "1";
const ROOT = new URL("../../../", import.meta.url).pathname;
const RESULTS = new URL("./results/", import.meta.url).pathname;
// describe.skipIf still RUNS the describe body (to collect tests), so a missing key file must never throw at load: the suite
// skips itself with a message instead.
const KEY_A = process.env.POPCORN_KEY ?? `${ROOT}keys/deployer.json`;
const KEY_ZERO = process.env.POPCORN_ZERO_KEY ?? `${ROOT}keys/zero.json`;
const ON = WANTED && [KEY_A, KEY_ZERO].every((f) => existsSync(f));
if (WANTED && !ON) {
  console.warn(`[phase4.network] SKIPPED: missing key file(s) ${[KEY_A, KEY_ZERO].filter((f) => !existsSync(f)).join(", ")}. Create them with \`scripts/new-key.sh p4-a\` and \`scripts/new-key.sh p4-zero\`, fund p4-a with \`scripts/faucet.sh keys/deployer.json\` (p4-zero stays at 0 ETH), or set POPCORN_KEY / POPCORN_ZERO_KEY. See packages/sdk/README.md, "Test keys".`);
}
const DUMMY_KEY: Hex = "0x0000000000000000000000000000000000000000000000000000000000000001";
const key = (f: string): Hex => (ON ? (JSON.parse(readFileSync(f, "utf8")) as { private_key: Hex }[])[0]!.private_key : DUMMY_KEY);
const bytecode = (name: string): Hex => JSON.parse(readFileSync(`${ROOT}contracts/out/${name}.sol/${name}.json`, "utf8")).bytecode.object;
const chain = devnetChain("devnet1");
const FACTORY = (deployments.devnet1?.factory ?? "0x0000000000000000000000000000000000000000") as Address;
const HAS_FACTORY = deployments.devnet1 !== undefined;
const results: Record<string, unknown> = { at: new Date().toISOString(), factory: FACTORY, coreCreationHash: DEFAULT_CORE.creationHash };
const j = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

describe.skipIf(!ON || !HAS_FACTORY)("client on devnet1", () => {
  const deployerAccount = privateKeyToAccount(key(KEY_A));
  const zeroAccount = privateKeyToAccount(key(KEY_ZERO));
  const deployer = createWalletClient({ account: deployerAccount, chain, transport: http() }).extend(popcorn());
  const noAccount = createPublicClient({ chain, transport: http() }).extend(popcorn());
  const zero = createWalletClient({ account: zeroAccount, chain, transport: http() }).extend(popcorn());
  const pub = createPublicClient({ chain, transport: http() });
  afterAll(() => {
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(`${RESULTS}client.json`, JSON.stringify(j(results), null, 2) + "\n");
  });

  it("the deployments module's factory pins the shipped Core build; pure helpers equal the factory's", async () => {
    const h = await pub.readContract({ address: FACTORY, abi: ruleFactoryAbi, functionName: "coreCreationCodeHash" });
    expect(h).toBe(DEFAULT_CORE.creationHash);
    const r = prng(4);
    for (let i = 0; i < 10; i++) {
      const a = defaultRuleContractArgs({ logic: FACTORY, baseFee: BigInt(Math.floor(r() * 1e10)), suggestedTip: BigInt(Math.floor(r() * 1e10)), caps: { conditionGas: 5_000 + Math.floor(r() * 200_000), maxVerifyDataLength: Math.floor(r() * 8192), maxTriggerDataLength: Math.floor(r() * 4096) } });
      expect(await pub.readContract({ address: FACTORY, abi: ruleFactoryAbi, functionName: "maxCostPerTrigger", args: [a] })).toBe(maxCostPerTrigger(a));
      expect(await pub.readContract({ address: FACTORY, abi: ruleFactoryAbi, functionName: "verifyFloorAtCaps", args: [a] })).toBe(verifyFloorAtCaps(a));
    }
    results.factoryHash = h;
  }, 120_000);

  it("checkRuleContractArgsLocal agrees with factory.checkArgs (eth_call) on 40 args near the bounds", async () => {
    const logic = (JSON.parse(readFileSync(`${ROOT}core/test/integration/deployed.json`, "utf8")) as { logic: Record<string, { address: Address }> }).logic.AlwaysTrueRule!.address;
    const r = prng(77);
    const base = defaultRuleContractArgs({ logic, baseFee: 7n, suggestedTip: 1_000_000_000n });
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
    const rows: { local: string | null; factory: string | null }[] = [];
    for (let i = 0; i < 40; i++) {
      const a: RuleContractArgs = { ...base };
      a.conditionGas = pick([4_999, 5_000, 20_000, 300_000]);
      a.maxVerifyDataLength = pick([0, 256, 8_192, 8_193]);
      a.maxTriggerDataLength = pick([0, 32, 4_096, 4_097]);
      a.maxFeePerGas = pick([0n, 1n, 4_000_000_000n, 1_000_000_000_000n, 1_000_000_000_001n]);
      a.maxPriorityFeePerGas = pick([0n, a.maxFeePerGas, a.maxFeePerGas + 1n]);
      a.maxStateGasPerFrame = pick([0n, 64n * 97_920n, 64n * 97_920n + 1n]);
      const floor = verifyFloorAtCaps(a);
      a.maxGasPerFrame = pick([floor - 1n, floor, 200_000n, 16_777_216n, 16_777_217n]);
      let factory: string | null = null;
      try {
        await pub.readContract({ address: FACTORY, abi: ruleFactoryAbi, functionName: "checkArgs", args: [a] });
      } catch (e) {
        factory = String((e as { cause?: { data?: { errorName?: string } } }).cause?.data?.errorName ?? (e as Error).message.split("\n")[0]);
      }
      const local = checkRuleContractArgsLocal(a);
      rows.push({ local, factory });
      expect(local, JSON.stringify(j(a))).toBe(factory);
    }
    results.checkArgsMirror = { cases: rows.length, accepted: rows.filter((x) => x.local === null).length, refusedBy: [...new Set(rows.map((x) => x.local).filter(Boolean))] };
  }, 180_000);

  let example: { ruleContract: Address; createTx: Hex; trigger: Hex; state: string; link: string };
  it("example script end to end (deploy + fund via factory, trigger from a client with no account, watch → included)", async () => {
    const out = execFileSync("bun", ["packages/sdk/examples/always-true.ts"], { cwd: ROOT, env: { ...process.env, POPCORN_KEY: process.env.POPCORN_KEY ?? `${ROOT}keys/deployer.json` }, encoding: "utf8", timeout: 400_000 });
    example = JSON.parse(out.trim().split("\n").at(-1)!);
    expect(example.state).toBe("included");
    const rc = await pub.getTransactionReceipt({ hash: example.trigger });
    expect(rc.status).toBe("success");
    expect((rc as unknown as { payer?: string }).payer?.toLowerCase()).toBe(example.ruleContract.toLowerCase());
    results.example = { ...example, block: rc.blockNumber, gasUsed: rc.gasUsed, route: await noAccount.popcornRoute() };
  }, 420_000);

  it("trigger from a wallet holding 0 ETH (keys/zero.json) is included; the wallet still has 0 ETH", async () => {
    expect(await pub.getBalance({ address: zeroAccount.address })).toBe(0n);
    const hash = await zero.trigger(example.ruleContract, { triggerData: toHex(`zero-wallet ${Date.now()}`) });
    const s = await zero.watch(hash);
    expect(s.state).toBe("included");
    expect(await pub.getBalance({ address: zeroAccount.address })).toBe(0n);
    results.zeroWalletTrigger = { hash, link: zero.explorerUrl(hash), block: s.state === "included" ? s.blockNumber : null };
  }, 240_000);

  it("deployRule refuses fund < factory.maxCostPerTrigger without sending anything", async () => {
    const nonce = await pub.getTransactionCount({ address: deployerAccount.address });
    const info = await noAccount.readRuleContract(example.ruleContract);
    const e = await deployer.deployRule({ logic: info.args.logic, fund: 1n }).catch((x) => x);
    expect(e).toBeInstanceOf(InsufficientRuleContractBalance);
    expect(await pub.getTransactionCount({ address: deployerAccount.address })).toBe(nonce);
    results.underfunded = { error: (e as Error).message };
  }, 60_000);

  let flag: Address;
  const fire = () => encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [0n, BigInt(Date.now())]);
  it("canTrigger false (FlagRule FIRE with the flag off) → trigger throws RuleContractNotReady(0x22) and sends nothing", async () => {
    const d = await deployer.deployRule({ logic: { bytecode: bytecode("FlagRule") }, fund: parseEther("0.01"), caps: { maxTriggerDataLength: 64 } });
    flag = d.ruleContract;
    const triggerData = fire();
    const r = await noAccount.canTrigger(flag, { triggerData });
    expect(r).toMatchObject({ ready: false, code: 0x22, name: "CONDITION_FALSE" });
    const before = await pub.getBalance({ address: flag });
    const e = await noAccount.trigger(flag, { triggerData }).catch((x) => x);
    expect(e).toBeInstanceOf(RuleContractNotReady);
    expect(e).toMatchObject({ code: 0x22, coreName: "CONDITION_FALSE" });
    // nothing sent: the exact tx trigger() built is unknown to the node, and the rule contract's balance is unchanged a block later
    const hash = r.tx && (await import("../src/encoder.ts")).txHash(r.tx);
    expect(await pub.request({ method: "eth_getTransactionByHash", params: [hash as Hex] })).toBeNull();
    const b0 = await pub.getBlockNumber();
    for (let i = 0; i < 30 && (await pub.getBlockNumber()) === b0; i++) await new Promise((res) => setTimeout(res, 1500));
    expect(await pub.getBalance({ address: flag })).toBe(before);
    results.notReady = { ruleContract: flag, createTx: d.txHash, logicTx: d.logicTxHash, code: "0x22", name: e.coreName, unsentHash: hash, balanceUnchanged: true };
  }, 300_000);

  it("after a SET_ON trigger the same rule contract is ready and the FIRE trigger is included", async () => {
    const setOn = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1n, BigInt(Date.now())]);
    const h1 = await noAccount.trigger(flag, { triggerData: setOn });
    expect((await noAccount.watch(h1)).state).toBe("included");
    const triggerData = fire();
    const r = await noAccount.canTrigger(flag, { triggerData });
    expect(r).toMatchObject({ ready: true, name: "READY", canonical: true });
    const h2 = await noAccount.trigger(flag, { triggerData });
    const s = await noAccount.watch(h2);
    expect(s.state).toBe("included");
    results.flagFlip = { setOn: h1, fire: h2, fireVerifyGasLimit: r.verifyGasLimit, links: [noAccount.explorerUrl(h1), noAccount.explorerUrl(h2)] };
  }, 400_000);

  it("simulate: valid trigger → ethrex valid + sidecar admitted; fee above cap → Core 0x12 MAX_FEE_ABOVE_CAP; trigger() → FeeAboveCap", async () => {
    const good = await noAccount.simulate(example.ruleContract, { triggerData: toHex(`sim-good ${Date.now()}`) });
    expect(good.ethrex.valid).toBe(true);
    expect(good.ethrex.canonicalMempoolValid).toBe(true);
    expect(good.ethrex.verifyGas).toBeGreaterThan(0n);
    expect(good.coreError).toBeUndefined();
    expect(good.verifyGasLimit).toBeGreaterThanOrEqual(good.floor);
    if (good.sidecar) expect(good.sidecar.admitted).toBe(true);
    const info = await noAccount.readRuleContract(example.ruleContract);
    const triggerData = toHex(`sim-overcap ${Date.now()}`);
    const bad = await noAccount.simulate(example.ruleContract, { triggerData, fees: { maxFeePerGas: info.args.maxFeePerGas + 1n } });
    expect(bad.ethrex.valid).toBe(false);
    expect(bad.coreError).toMatchObject({ code: 0x12, name: "MAX_FEE_ABOVE_CAP" });
    if (bad.sidecar) expect(bad.sidecar).toMatchObject({ admitted: false, code: -32500 });
    const e = await noAccount.trigger(example.ruleContract, { triggerData, fees: { maxFeePerGas: info.args.maxFeePerGas + 1n } }).catch((x) => x);
    expect(e).toBeInstanceOf(FeeAboveCap);
    results.simulate = { good: j({ ethrex: good.ethrex, sidecar: good.sidecar, sidecarError: good.sidecarError, verifyGasLimit: good.verifyGasLimit, floor: good.floor, maxCost: good.maxCost, minOperatingBalance: good.minOperatingBalance }), overCap: j({ ethrex: bad.ethrex, sidecar: bad.sidecar, coreError: bad.coreError }) };
  }, 180_000);

  it("nonce key from the shadow run equals the storage-dependent key (RecorderRule: keccak(abi.encode(triggerData, epoch)))", async () => {
    const d = JSON.parse(readFileSync(`${ROOT}core/test/integration/deployed.json`, "utf8")) as { ruleContracts: Record<string, { address: Address }> };
    const rec = d.ruleContracts.rec!.address;
    const info = await noAccount.readRuleContract(rec);
    const triggerData = toHex("shadow");
    const epoch = BigInt((await pub.getStorageAt({ address: rec, slot: keccak256(toHex("popcorn.test.RecorderKernel.epoch")) })) ?? "0x0");
    expect(epoch).toBeGreaterThan(0n);
    const ctx = noAccount.popcorn;
    const k = await deriveNonceKey(ctx.rpc, rec, info.args.logic, triggerData, DEFAULT_CORE.constants.nonceKeyGas);
    expect(k).toBe(BigInt(keccak256(encodeAbiParameters([{ type: "bytes" }, { type: "uint256" }], [triggerData, epoch]))));
    results.shadowKey = { ruleContract: rec, epoch, key: toHex(k) };
  }, 60_000);

  it("acceptance: the example's trigger through the public gateway (PENDING while it returns 5xx)", async (t) => {
    const up = await isGatewayUp("devnet1");
    results.gateway = up ? "up" : `PENDING: gateway down (checked ${new Date().toISOString()})`;
    if (!up) return t.skip();
    const hash = await noAccount.trigger(example.ruleContract, { triggerData: toHex(`gateway ${Date.now()}`), via: "gateway" });
    const s = await noAccount.watch(hash, { mempools: ["gateway"] });
    expect(s.state).toBe("included");
    results.gatewayTrigger = { hash, link: noAccount.explorerUrl(hash) };
  }, 300_000);
});
