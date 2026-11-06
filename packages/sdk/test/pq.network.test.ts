// Post-quantum network tests on the LOCAL devnet: SPHINCS+-style, Falcon (ETHFALCON) and the ECDSA hybrids, unstaked and staked.
// Skipped unless POPCORN_NETWORK=1. The Falcon signer needs python3 with numpy, pycryptodome and polyntt (POPCORN_FALCON_PYTHON); without it the Falcon tests skip.
//   POPCORN_NETWORK=1 POPCORN_DEVNET=local POPCORN_FALCON_PYTHON=/path/to/python3 vitest run test/pq.network.test.ts --reporter verbose
// Results: test/results/intent.json (merged with intent.network.test.ts).
import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { concat, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { falconKeygen, falconSignDigest, forsIntentSigner, forsKeygen, hybridEcdsaParams, intentDigest, memoryUsageStore, signEcdsaIntent, sphincsKeygen, sphincsParams, sphincsSign, sphincsSteps, forsParams, xmssIntentKey, xmssParams, xmssIntentSigner, xmssKeygen, xmssSigBytes } from "../src/index.ts";
import { WANTED, bindingFor, chainUp, deployIntentRuleContract, keyFile, loadKey, makeClients, triggerAndMeasure, triggerDataFor, predicateAddress, results, saveResults, type Clients, type TriggerMeasure, type Rows } from "./intent.helpers.ts";

const up = WANTED && (await chainUp());
const ON = WANTED && up && existsSync(keyFile(5));
const FALCON_PY = process.env.POPCORN_FALCON_PYTHON;
const rows = results.rows as Rows[];
const record = (r: TriggerMeasure) => {
  rows.push(r as unknown as Rows);
  console.log(JSON.stringify(r));
};
const SPX_BUDGET = { maxSteps: Number(process.env.T2_SPX_STEPS ?? 560), maxTries: 400 };
const stepsLog: number[] = [];
const WB = (ruleContract: `0x${string}`) => ({ chainId: 1338n, ruleContract, ruleId: 0n }) as const;
const sk = (label: string): Hex => keccak256(toHex(`t2pq ${label}`));

describe.skipIf(!ON)("post-quantum predicates on the local devnet", () => {
  const c: Clients = ON ? makeClients(loadKey(5)) : (undefined as never);
  afterAll(() => {
    if (stepsLog.length) rows.push({ scheme: "SPHINCS+ (keccak, n=16, h=20)", variant: "signer steps (budget " + SPX_BUDGET.maxSteps + ")", steps: stepsLog });
    saveResults();
  });
  const spx = ON ? sphincsKeygen(sk("sphincs skSeed"), sk("sphincs pubSeed")) : (undefined as never);

  it("SPHINCS+-style (unstaked rule contract, 250k budget)", async () => {
    const k = await deployIntentRuleContract(c, { predicate: "SphincsSigner", params: sphincsParams(spx), conditionGas: 200_000, maxVerifyDataLength: 5200 });
    const triggerData = triggerDataFor(0n, 5n);
    const t0 = Date.now();
    const dg = intentDigest(bindingFor(k.ruleContract, 0n, 0n, triggerData));
    const w = sphincsSign(spx, dg, SPX_BUDGET);
    stepsLog.push(sphincsSteps(spx.pubSeed, spx.root, dg, w));
    const m = await triggerAndMeasure(c, k, "SPHINCS+ (keccak, n=16, h=20)", triggerData, w, { tight: true });
    record({ ...m, signMs: Date.now() - t0 } as TriggerMeasure);
    expect(m.state).toBe("included");
  }, 900_000);

  it("SPHINCS+-style (STAKED rule contract)", async () => {
    const k = await deployIntentRuleContract(c, { predicate: "SphincsSigner", params: sphincsParams(spx), conditionGas: 200_000, maxVerifyDataLength: 5200, stake: true });
    const triggerData = triggerDataFor(0n, 5n);
    const dg = intentDigest(bindingFor(k.ruleContract, 0n, 0n, triggerData));
    const w = sphincsSign(spx, dg, SPX_BUDGET);
    stepsLog.push(sphincsSteps(spx.pubSeed, spx.root, dg, w));
    const m = await triggerAndMeasure(c, k, "SPHINCS+ (keccak, n=16, h=20)", triggerData, w, { tight: true, variant: "staked rule contract" });
    record(m);
    expect(m.state).toBe("included");
  }, 900_000);

  it("Falcon-512 / ETHFALCON (staked rule contract; the unstaked budget refuses it)", async () => {
    if (!FALCON_PY) return console.warn("[t2pq] Falcon tests skipped: set POPCORN_FALCON_PYTHON to a python3 with numpy, pycryptodome and polyntt");
    const key = falconKeygen();
    const kUn = await deployIntentRuleContract(c, { predicate: "FalconSigner", params: key.params, conditionGas: 1_700_000, maxVerifyDataLength: 1064 });
    const triggerData = triggerDataFor(0n, 5n);
    const w = falconSignDigest(key, intentDigest(bindingFor(kUn.ruleContract, 0n, 0n, triggerData)));
    const un = await triggerAndMeasure(c, kUn, "Falcon-512 (ETHFALCON)", triggerData, w, { tight: true, variant: "unstaked rule contract" });
    record(un);
    expect(un.state).not.toBe("included");
    const kSt = await deployIntentRuleContract(c, { predicate: "FalconSigner", params: key.params, conditionGas: 1_700_000, maxVerifyDataLength: 1064, stake: true });
    const w2 = falconSignDigest(key, intentDigest(bindingFor(kSt.ruleContract, 0n, 0n, triggerData)));
    const m = await triggerAndMeasure(c, kSt, "Falcon-512 (ETHFALCON)", triggerData, w2, { tight: true, variant: "staked rule contract" });
    record(m);
    expect(m.state).toBe("included");
  }, 1_200_000);

  // ---------------------------------------------------------------- hybrid wrappers: ECDSA AND the post-quantum scheme

  it("Hybrid ECDSA + FORS", async () => {
    const key = forsKeygen(sk("fors skSeed"), sk("fors pubSeed"));
    const inner = await predicateAddress(c, "ForsSigner");
    const k = await deployIntentRuleContract(c, { predicate: "HybridEcdsaSigner", params: hybridEcdsaParams(c.account.address, inner, forsParams(key, 0, 1338, 0)), conditionGas: 110_000, maxVerifyDataLength: 65 + 6944 });
    const signer = forsIntentSigner({ key, firstEpoch: 0, binding: WB(k.ruleContract), store: memoryUsageStore() });
    const triggerData = triggerDataFor(0n, 5n);
    const b = bindingFor(k.ruleContract, 0n, 0n, triggerData);
    const m = await triggerAndMeasure(c, k, "Hybrid ECDSA+FORS", triggerData, concat([await signEcdsaIntent(c.account, b), signer.sign(b)]), { tight: true });
    record(m);
    expect(m.state).toBe("included");
  }, 600_000);

  it("Hybrid ECDSA + XMSS/LMS-style (height 10)", async () => {
    const tree = xmssKeygen(sk("xmss skSeed"), sk("xmss I"), 10);
    const inner = await predicateAddress(c, "XmssSigner");
    const k = await deployIntentRuleContract(c, { predicate: "HybridEcdsaSigner", params: hybridEcdsaParams(c.account.address, inner, xmssParams(xmssIntentKey(tree, 0, 1338, 0))), conditionGas: 120_000, maxVerifyDataLength: 65 + xmssSigBytes(10) });
    const signer = xmssIntentSigner({ tree, firstEpoch: 0, binding: WB(k.ruleContract), store: memoryUsageStore(), budget: { maxSteps: 450, maxTries: 400_000 } });
    const triggerData = triggerDataFor(0n, 5n);
    const b = bindingFor(k.ruleContract, 0n, 0n, triggerData);
    const m = await triggerAndMeasure(c, k, "Hybrid ECDSA+XMSS (h=10)", triggerData, concat([await signEcdsaIntent(c.account, b), signer.sign(b)]), { tight: true });
    record(m);
    expect(m.state).toBe("included");
  }, 900_000);

  it("Hybrid ECDSA + SPHINCS+-style", async () => {
    const inner = await predicateAddress(c, "SphincsSigner");
    const k = await deployIntentRuleContract(c, { predicate: "HybridEcdsaSigner", params: hybridEcdsaParams(c.account.address, inner, sphincsParams(spx)), conditionGas: 205_000, maxVerifyDataLength: 65 + 5200 });
    const triggerData = triggerDataFor(0n, 5n);
    const b = bindingFor(k.ruleContract, 0n, 0n, triggerData);
    const m = await triggerAndMeasure(c, k, "Hybrid ECDSA+SPHINCS+", triggerData, concat([await signEcdsaIntent(c.account, b), sphincsSign(spx, intentDigest(b), SPX_BUDGET)]), { tight: true });
    record(m);
    expect(m.state).toBe("included");
  }, 900_000);

  it("Hybrid ECDSA + Falcon (staked rule contract)", async () => {
    if (!FALCON_PY) return console.warn("[t2pq] Falcon tests skipped: set POPCORN_FALCON_PYTHON");
    const key = falconKeygen();
    const inner = await predicateAddress(c, "FalconSigner");
    const k = await deployIntentRuleContract(c, { predicate: "HybridEcdsaSigner", params: hybridEcdsaParams(c.account.address, inner, key.params), conditionGas: 1_750_000, maxVerifyDataLength: 65 + 1064, stake: true });
    const triggerData = triggerDataFor(0n, 5n);
    const b = bindingFor(k.ruleContract, 0n, 0n, triggerData);
    const m = await triggerAndMeasure(c, k, "Hybrid ECDSA+Falcon", triggerData, concat([await signEcdsaIntent(c.account, b), falconSignDigest(key, intentDigest(b))]), { tight: true, variant: "staked rule contract" });
    record(m);
    expect(m.state).toBe("included");
  }, 1_200_000);
});
void privateKeyToAccount;
