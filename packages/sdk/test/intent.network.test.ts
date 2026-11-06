// Signed-intent network tests: signers on the LOCAL devnet (chain 1338, patched sidecar). Skipped unless POPCORN_NETWORK=1.
//   POPCORN_NETWORK=1 POPCORN_DEVNET=local vitest run test/intent.network.test.ts --reporter verbose
// Keys: dev-5 deploys, funds and signs; dev-6 is a second signer. Triggers are sent by FRESH keys that never hold ETH.
// Results (gas, canonical verdict, admission, tx hashes): test/results/intent.json.
import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { concat, type Hex } from "viem";
import {
  RuleContractNotReady,
  Scheme,
  attestedParams,
  attestedWitness,
  buildWebAuthnAssertion,
  ecdsaParams,
  hybridEcdsaWotsParams,
  intentDigest,
  memoryUsageStore,
  multisigParams,
  multisigWitness,
  p256Keygen,
  p256Params,
  signAttestation,
  signEcdsaIntent,
  signP256Intent,
  webauthnParams,
  wotsIntentSigner,
  wotsIntentKey,
  wotsParams,
  xmssIntentKey,
  wotsKeygen,
  forsKeygen,
  forsIntentSigner,
  xmssKeygen,
  xmssIntentSigner,
  xmssSigBytes,
  attestationDigest,
} from "../src/index.ts";
import { WANTED, bindingFor, chainUp, deployIntentRuleContract, keyFile, loadKey, makeClients, triggerAndMeasure, triggerDataFor, predicateAddress, results, saveResults, type Clients, type TriggerMeasure, type Rows } from "./intent.helpers.ts";

const up = WANTED && (await chainUp());
const ON = WANTED && up && existsSync(keyFile(5)) && existsSync(keyFile(6));
if (WANTED && !ON) console.warn(`[t2.network] SKIPPED: ${!up ? "the local devnet (chain 1338 at 127.0.0.1:18545) is not reachable" : `missing ${keyFile(5)} or ${keyFile(6)} (set POPCORN_KEYS_DIR)`}.`);
const rows = results.rows as Rows[];
const record = (r: TriggerMeasure) => {
  rows.push(r as unknown as Rows);
  console.log(JSON.stringify(r));
};
const WB = (ruleContract: `0x${string}`, ruleId = 0n) => ({ chainId: 1338n, ruleContract, ruleId }) as const;
const BUDGET = { maxSteps: 400, maxTries: 200_000 }; // predicate-path rule contracts (conditionGas 85-95k); the 100k inline rule contracts below pass their own
const sk = (label: string): Hex => `0x${Buffer.from(label.padEnd(32, "_")).toString("hex")}` as Hex;

describe.skipIf(!ON)("T2 signed intents on the local devnet", () => {
  const c: Clients = ON ? makeClients(loadKey(5)) : (undefined as never);
  const dev6 = ON ? privateKeyToAccount(loadKey(6)) : (undefined as never);
  const tree = ON ? wotsKeygen(sk("t2 wots skSeed"), sk("t2 wots pubSeed")) : (undefined as never);
  afterAll(() => saveResults());

  it("ECDSA: signed by dev-5, triggered by a 0-ETH key, included; verify gas recorded", async () => {
    const k = await deployIntentRuleContract(c, { predicate: "EcdsaSigner", params: ecdsaParams(c.account.address), conditionGas: 25_000, maxVerifyDataLength: 65 });
    const triggerData = triggerDataFor(0n, 5n);
    const w = await signEcdsaIntent(c.account, bindingFor(k.ruleContract, 0n, 0n, triggerData));
    const m = await triggerAndMeasure(c, k, "ECDSA", triggerData, w, { tight: true });
    record(m);
    expect(m.state).toBe("included");
    expect(m.triggererBalanceAfter).toBe("0");
  }, 400_000);

  it("replay, rule and rule contract binding on the ECDSA rule contract", async () => {
    const spec = { predicate: "EcdsaSigner", params: ecdsaParams(c.account.address), conditionGas: 60_000, maxVerifyDataLength: 65 };
    const k1 = await deployIntentRuleContract(c, spec);
    const k2 = await deployIntentRuleContract(c, { ...spec, reuse: k1 });
    const p = c.freshTriggerer().client;
    const a0 = triggerDataFor(0n, 3n);
    const w0 = await signEcdsaIntent(c.account, bindingFor(k1.ruleContract, 0n, 0n, a0));
    // an intent signed for rule contract k1 cannot trigger k2; one signed for rule 0 cannot trigger rule 1
    const onK2 = await p.canTrigger(k2.ruleContract, { triggerData: a0, verifyData: w0 });
    expect(onK2).toMatchObject({ ready: false, name: "CONDITION_FALSE" });
    const a1 = triggerDataFor(1n, 3n);
    const onRule1 = await p.canTrigger(k1.ruleContract, { triggerData: a1, verifyData: w0 });
    expect(onRule1).toMatchObject({ ready: false, name: "CONDITION_FALSE" });
    // the real one works once...
    expect(await p.canTrigger(k1.ruleContract, { triggerData: a0, verifyData: w0 })).toMatchObject({ ready: true });
    const hash = await p.trigger(k1.ruleContract, { triggerData: a0, verifyData: w0 });
    const st = await p.watch(hash);
    expect(st.state).toBe("included");
    // ...and the second time it is refused: the rule contract is at epoch 1
    const again = await p.canTrigger(k1.ruleContract, { triggerData: a0, verifyData: w0 });
    expect(again).toMatchObject({ ready: false, name: "CONDITION_FALSE" });
    const e = await p.trigger(k1.ruleContract, { triggerData: a0, verifyData: w0 }).catch((x) => x);
    expect(e).toBeInstanceOf(RuleContractNotReady);
    // k2 is untouched and takes its own intent; rule 1 on k1 takes its own (epoch 0 of rule 1)
    const wk2 = await signEcdsaIntent(c.account, bindingFor(k2.ruleContract, 0n, 0n, a0));
    expect(await p.canTrigger(k2.ruleContract, { triggerData: a0, verifyData: wk2 })).toMatchObject({ ready: true });
    const w1 = await signEcdsaIntent(c.account, bindingFor(k1.ruleContract, 1n, 0n, a1));
    expect(await p.canTrigger(k1.ruleContract, { triggerData: a1, verifyData: w1 })).toMatchObject({ ready: true });
    // the next epoch of rule 0 needs a signature for epoch 1
    const w0e1 = await signEcdsaIntent(c.account, bindingFor(k1.ruleContract, 0n, 1n, a0));
    expect(await p.canTrigger(k1.ruleContract, { triggerData: a0, verifyData: w0e1 })).toMatchObject({ ready: true });
    rows.push({ scheme: "ECDSA", variant: "replay/rule/rule contract binding", ruleContract1: k1.ruleContract, ruleContract2: k2.ruleContract, includedTrigger: hash, secondTrigger: "refused (CONDITION_FALSE, RuleContractNotReady)", otherRuleContract: "refused (CONDITION_FALSE)", otherRule: "refused (CONDITION_FALSE)" });
  }, 600_000);

  it("P256 raw (EIP-7951 precompile at 0x100)", async () => {
    const key = p256Keygen();
    const k = await deployIntentRuleContract(c, { predicate: "P256Signer", params: p256Params(key), conditionGas: 30_000, maxVerifyDataLength: 64 });
    const triggerData = triggerDataFor(0n, 5n);
    const w = signP256Intent(key, bindingFor(k.ruleContract, 0n, 0n, triggerData));
    const m = await triggerAndMeasure(c, k, "P256", triggerData, w, { fallbackRpc: true, tight: true });
    record(m);
    expect(m.state).toBe("included");
  }, 400_000);

  it("WebAuthn (passkey assertion, challenge = digest)", async () => {
    const key = p256Keygen();
    const k = await deployIntentRuleContract(c, { predicate: "WebAuthnSigner", params: webauthnParams({ ...key, rpId: "popcorn.example" }), conditionGas: 50_000, maxVerifyDataLength: 400 });
    const triggerData = triggerDataFor(0n, 5n);
    const a = buildWebAuthnAssertion(key, intentDigest(bindingFor(k.ruleContract, 0n, 0n, triggerData)), { rpId: "popcorn.example" });
    const m = await triggerAndMeasure(c, k, "WebAuthn", triggerData, a.witness, { fallbackRpc: true, tight: true });
    record(m);
    expect(m.state).toBe("included");
  }, 400_000);

  it("WOTS+ (leaf = ruleEpoch - firstEpoch)", async () => {
    const k = await deployIntentRuleContract(c, { predicate: "WotsSigner", params: wotsParams(wotsIntentKey(tree, 0, 1338, 0)), conditionGas: 85_000, maxVerifyDataLength: 2496 });
    const signer = wotsIntentSigner({ tree, firstEpoch: 0, binding: WB(k.ruleContract), store: memoryUsageStore(), budget: BUDGET });
    const triggerData = triggerDataFor(0n, 5n);
    const w = signer.sign(bindingFor(k.ruleContract, 0n, 0n, triggerData));
    const m = await triggerAndMeasure(c, k, "WOTS+", triggerData, w, { tight: true });
    record(m);
    expect(m.state).toBe("included");
  }, 600_000);

  it("Hybrid ECDSA + WOTS+", async () => {
    const k = await deployIntentRuleContract(c, { predicate: "HybridEcdsaWotsSigner", params: hybridEcdsaWotsParams(c.account.address, wotsIntentKey(tree, 0, 1338, 0)), conditionGas: 90_000, maxVerifyDataLength: 65 + 2496 });
    const wots = wotsIntentSigner({ tree, firstEpoch: 0, binding: WB(k.ruleContract), store: memoryUsageStore(), budget: BUDGET });
    const triggerData = triggerDataFor(0n, 5n);
    const b = bindingFor(k.ruleContract, 0n, 0n, triggerData);
    const w = concat([await signEcdsaIntent(c.account, b), wots.sign(b)]);
    const m = await triggerAndMeasure(c, k, "Hybrid ECDSA+WOTS+", triggerData, w, { tight: true });
    record(m);
    expect(m.state).toBe("included");
  }, 600_000);

  it("Multisig 2-of-3 mixed (ECDSA, P256, WOTS+): ECDSA + WOTS+ sign", async () => {
    const p256 = p256Keygen();
    const signers = [
      { scheme: Scheme.ECDSA, key: ecdsaParams(c.account.address) },
      { scheme: Scheme.P256, key: p256Params(p256) },
      { scheme: Scheme.WOTS, key: wotsParams(wotsIntentKey(tree, 0, 1338, 0)) },
    ];
    const params = multisigParams(2, signers);
    const k = await deployIntentRuleContract(c, { predicate: "MultisigSigner", params, conditionGas: 95_000, maxVerifyDataLength: 65 + 2496 + 16 });
    const wots = wotsIntentSigner({ tree, firstEpoch: 0, binding: WB(k.ruleContract), store: memoryUsageStore(), budget: BUDGET });
    const triggerData = triggerDataFor(0n, 5n);
    const b = bindingFor(k.ruleContract, 0n, 0n, triggerData);
    const w = multisigWitness(2, [
      { index: 0, sig: await signEcdsaIntent(c.account, b) },
      { index: 2, sig: wots.sign(b) },
    ]);
    const m = await triggerAndMeasure(c, k, "Multisig 2-of-3", triggerData, w, { variant: "ECDSA + WOTS+", tight: true });
    record(m);
    expect(m.state).toBe("included");
    // the other pairs on a second rule contract with the same keys (P256 needed): evaluated with simulate only (no second trigger on this rule contract's epoch)
  }, 600_000);

  it("Multisig 2-of-3 mixed: ECDSA + P256 sign", async () => {
    const p256 = p256Keygen();
    const params = multisigParams(2, [
      { scheme: Scheme.ECDSA, key: ecdsaParams(c.account.address) },
      { scheme: Scheme.P256, key: p256Params(p256) },
      { scheme: Scheme.WOTS, key: wotsParams(wotsIntentKey(tree, 0, 1338, 0)) },
    ]);
    const k = await deployIntentRuleContract(c, { predicate: "MultisigSigner", params, conditionGas: 95_000, maxVerifyDataLength: 65 + 2496 + 16 });
    const triggerData = triggerDataFor(0n, 5n);
    const b = bindingFor(k.ruleContract, 0n, 0n, triggerData);
    const w = multisigWitness(2, [
      { index: 0, sig: await signEcdsaIntent(c.account, b) },
      { index: 1, sig: signP256Intent(p256, b) },
    ]);
    const m = await triggerAndMeasure(c, k, "Multisig 2-of-3", triggerData, w, { variant: "ECDSA + P256", fallbackRpc: true, tight: true });
    record(m);
    expect(m.state).toBe("included");
  }, 600_000);

  it("Attested fact 2-of-3 (attestors dev-5, dev-6 and a fresh key sign the statement for this trigger)", async () => {
    const third = privateKeyToAccount(generatePrivateKey());
    const statement = sk("ETH/USD above 5000");
    const attestors = [c.account, dev6, third];
    const k = await deployIntentRuleContract(c, { predicate: "AttestedFactSigner", params: attestedParams(statement, 2, attestors.map((a) => a.address)), conditionGas: 45_000, maxVerifyDataLength: 2 * 66 });
    const triggerData = triggerDataFor(0n, 5n);
    const b = { ...bindingFor(k.ruleContract, 0n, 0n, triggerData), statement };
    expect(attestationDigest(b)).not.toBe(intentDigest(b));
    const w = attestedWitness(2, [
      { index: 0, sig: await signAttestation(c.account, b) },
      { index: 2, sig: await signAttestation(third, b) },
    ]);
    const m = await triggerAndMeasure(c, k, "Attested fact 2-of-3", triggerData, w, { tight: true });
    record(m);
    expect(m.state).toBe("included");
  }, 400_000);

  // ---------------------------------------------------------------- inline triggers (no predicate call, no blob): the versions built to fit the public budget

  it("ECDSA inline trigger", async () => {
    const k = await deployIntentRuleContract(c, { predicate: "", params: "0x", inline: { name: "EcdsaIntentCounter", args: [c.account.address] }, conditionGas: 20_000, maxVerifyDataLength: 65 });
    const triggerData = triggerDataFor(0n, 5n);
    const w = await signEcdsaIntent(c.account, bindingFor(k.ruleContract, 0n, 0n, triggerData));
    const m = await triggerAndMeasure(c, k, "ECDSA inline", triggerData, w, { tight: true });
    record(m);
    expect(m.state).toBe("included");
  }, 400_000);

  it("WOTS+ inline trigger, salt ground to fit the public 100k budget", async () => {
    const tgt = Number(process.env.T2_WOTS_TARGET ?? 380);
    const key = wotsIntentKey(tree, 0, 1338, 0);
    const k = await deployIntentRuleContract(c, { predicate: "", params: "0x", inline: { name: "WotsIntentCounter", args: [key.root, key.pubSeed, 0n, 1338n, 0n] }, conditionGas: 72_000, maxVerifyDataLength: 2496 });
    const signer = wotsIntentSigner({ tree, firstEpoch: 0, binding: WB(k.ruleContract), store: memoryUsageStore(), budget: { maxSteps: tgt, maxTries: 3_000_000 } });
    const triggerData = triggerDataFor(0n, 5n);
    const b = bindingFor(k.ruleContract, 0n, 0n, triggerData);
    const t0 = Date.now();
    const w = signer.sign(b);
    const steps = signer.stepsFor(intentDigest(b), `0x${w.slice(2, 66)}`);
    const m = await triggerAndMeasure(c, k, "WOTS+ inline", triggerData, w, { tight: true });
    record({ ...m, steps, grindMs: Date.now() - t0 } as TriggerMeasure);
    expect(m.state).toBe("included");
  }, 900_000);

  it("FORS inline trigger", async () => {
    const key = forsKeygen(sk("t2 fors skSeed"), sk("t2 fors pubSeed"));
    const k = await deployIntentRuleContract(c, { predicate: "", params: "0x", inline: { name: "ForsIntentCounter", args: [key.pk, key.pubSeed, 0n, 1338n, 0n] }, conditionGas: 70_000, maxVerifyDataLength: 6944 });
    const signer = forsIntentSigner({ key, firstEpoch: 0, binding: WB(k.ruleContract), store: memoryUsageStore() });
    const triggerData = triggerDataFor(0n, 5n);
    const w = signer.sign(bindingFor(k.ruleContract, 0n, 0n, triggerData));
    const m = await triggerAndMeasure(c, k, "FORS inline", triggerData, w, { tight: true });
    record(m);
    expect(m.state).toBe("included");
  }, 600_000);

  it("XMSS/LMS-style inline trigger (height 10)", async () => {
    const tree10 = xmssKeygen(sk("t2 xmss skSeed"), sk("t2 xmss I"), 10);
    const k = await deployIntentRuleContract(c, { predicate: "", params: "0x", inline: { name: "XmssIntentCounter", args: [tree10.root, tree10.I, 0n, 10n, 1338n, 0n] }, conditionGas: 72_000, maxVerifyDataLength: xmssSigBytes(10) });
    const signer = xmssIntentSigner({ tree: tree10, firstEpoch: 0, binding: WB(k.ruleContract), store: memoryUsageStore(), budget: { maxSteps: Number(process.env.T2_WOTS_TARGET ?? 380), maxTries: 3_000_000 } });
    const triggerData = triggerDataFor(0n, 5n);
    const w = signer.sign(bindingFor(k.ruleContract, 0n, 0n, triggerData));
    const m = await triggerAndMeasure(c, k, "XMSS inline (h=10)", triggerData, w, { tight: true });
    record(m);
    expect(m.state).toBe("included");
  }, 900_000);

  it("WOTS+ inline: two consecutive epochs (leaf 0, leaf 1), the replay of the first is refused", async () => {
    const key = wotsIntentKey(tree, 0, 1338, 0);
    const k = await deployIntentRuleContract(c, { predicate: "", params: "0x", inline: { name: "WotsIntentCounter", args: [key.root, key.pubSeed, 0n, 1338n, 0n] }, conditionGas: 72_000, maxVerifyDataLength: 2496 });
    const signer = wotsIntentSigner({ tree, firstEpoch: 0, binding: WB(k.ruleContract), store: memoryUsageStore(), budget: { maxSteps: 380, maxTries: 3_000_000 } });
    const triggerData = triggerDataFor(0n, 5n);
    const p = c.freshTriggerer().client;
    const w0 = signer.sign(bindingFor(k.ruleContract, 0n, 0n, triggerData));
    const w1 = signer.sign(bindingFor(k.ruleContract, 0n, 1n, triggerData));
    expect((await p.canTrigger(k.ruleContract, { triggerData, verifyData: w1 })).ready).toBe(false); // epoch 1's signature is not valid yet
    const h0 = await p.trigger(k.ruleContract, { triggerData, verifyData: w0 });
    expect((await p.watch(h0)).state).toBe("included");
    // refused either as CONDITION_FALSE or, when the stale signature's digits need more hash steps than conditionGas, as 0x20 (out of gas inside the condition: fail closed)
    const replay = await p.canTrigger(k.ruleContract, { triggerData, verifyData: w0 });
    expect(replay.ready).toBe(false);
    expect(["CONDITION_FALSE", "CONDITION_CALL_FAILED"]).toContain(replay.name);
    const h1 = await p.trigger(k.ruleContract, { triggerData, verifyData: w1 });
    expect((await p.watch(h1)).state).toBe("included");
    expect(() => signer.sign(bindingFor(k.ruleContract, 0n, 1n, triggerDataFor(0n, 6n)))).toThrow(/already signed a different digest/);
    rows.push({ scheme: "WOTS+ inline", variant: "epochs 0 and 1, replay refused", ruleContract: k.ruleContract, epoch0Pop: h0, epoch1Pop: h1, replayVerdict: replay.name });
  }, 900_000);
});
