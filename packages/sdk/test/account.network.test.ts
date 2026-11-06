// Sovereign Account on the local devnet: owner spends, hidden-guardian rotation and quantum switch, the post-quantum
// backup migration, and the contested-takeover forced exit. Every trigger is sent by a key with no ETH; the account pays.
// The ECDSA + Falcon owner runs when the Falcon signer works (POPCORN_FALCON_PYTHON); the rest runs with an ECDSA owner.
//   POPCORN_NETWORK=1 bun run --cwd packages/sdk vitest run test/account.network.test.ts --reporter verbose
// Keys: dev-3 deploys. Owners, guardians, backup keys and recipients are fresh.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MerkleTree, membershipProof, newIdentity } from "@popcorn/zk";
import {
  ACCOUNT_RULE,
  CONTEST_PREIMAGE,
  PROPOSAL_QUANTUM,
  accountBinding,
  contestRecovery,
  deploySovereignAccount,
  ecdsaParams,
  exitTrigger,
  falconKeygen,
  falconSignDigest,
  finalizeRecovery,
  guardianScope,
  guardianSignal,
  hybridEcdsaParams,
  initializeAccount,
  intentDigest,
  memoryUsageStore,
  migrateData,
  migrateTrigger,
  quantumData,
  quantumTrigger,
  rotationProposal,
  signEcdsaIntent,
  sovereignAccountAbi,
  spendData,
  spendTrigger,
  voteTrigger,
  wotsIntentKey,
  wotsIntentSigner,
  wotsKeygen,
  wotsParams,
} from "../src/index.ts";
import { RESULTS, WANTED, chainUp, j, keyFile, loadKey, makeClients } from "./intent.helpers.ts";

const ON = WANTED && (await chainUp()) && existsSync(keyFile(3));
const rows: Record<string, unknown>[] = [];
const fresh = () => privateKeyToAccount(generatePrivateKey()).address;
const CHAIN = 1338n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let falconOk = false;
try {
  falconKeygen();
  falconOk = true;
} catch {}

describe.skipIf(!ON)("Sovereign Account on the local devnet", () => {
  const c = ON ? makeClients(loadKey(3)) : (undefined as never);
  const dc = ON ? { wallet: c.deployer, pub: c.pub } : (undefined as never);
  afterAll(() => {
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(`${RESULTS}account.json`, JSON.stringify(j({ chain: "local (1338)", falcon: falconOk, rows }), null, 2));
  });
  const state = (account: Address) => c.pub.readContract({ address: account, abi: sovereignAccountAbi, functionName: "state" }) as Promise<readonly [Hex, bigint, boolean, boolean, boolean, Hex, bigint, Address]>;
  const round = (account: Address) => c.pub.readContract({ address: account, abi: sovereignAccountAbi, functionName: "guardianRound" }) as Promise<bigint>;
  const setup = async () => {
    const guardians = await Promise.all([newIdentity(), newIdentity(), newIdentity()]);
    const tree = await MerkleTree.create(20, guardians.map((g) => g.commitment));
    const backupTree = wotsKeygen(generatePrivateKey(), generatePrivateKey());
    const owner = privateKeyToAccount(generatePrivateKey());
    const d = await deploySovereignAccount(dc, c.deployer as never, { owner: "ecdsa", recoveryDelaySec: 15n });
    const backupParams = wotsParams(wotsIntentKey(backupTree, 0, CHAIN, ACCOUNT_RULE.MIGRATE));
    const exitAddress = fresh();
    await initializeAccount(dc, d.account, { ownerParams: ecdsaParams(owner.address), exitAddress, backupParams, guardiansRoot: await tree.root(), threshold: 2n });
    const fund = await c.deployer.sendTransaction({ to: d.account, value: parseEther("2"), gas: 100_000n });
    await c.pub.waitForTransactionReceipt({ hash: fund });
    return { d, guardians, tree, backupTree, backupParams, owner, exitAddress };
  };
  const vote = async (account: Address, s: Awaited<ReturnType<typeof setup>>, i: number, proposal: Hex) => {
    const r = await round(account);
    const p = await membershipProof({ secret: s.guardians[i]!.secret, tree: s.tree, index: i, signalHash: guardianSignal(proposal, r), externalNullifier: guardianScope(account, r) });
    const t = c.freshTriggerer().client;
    const hash = await t.trigger(account, voteTrigger(proposal, p.nullifierHash, p.proof as Hex));
    expect((await t.watch(hash)).state).toBe("included");
    return { hash, nullifierHash: p.nullifierHash, proof: p.proof as Hex };
  };

  it("owner spend, hidden-guardian rotation, guardian quantum switch, post-quantum backup migration", async () => {
    const s = await setup();
    const A = s.d.account;
    const t = c.freshTriggerer().client;
    // owner spend, paid by the account, sent by a 0-ETH key
    const to = fresh();
    const td = spendData(to, parseEther("0.1"));
    const w = await signEcdsaIntent(s.owner, accountBinding(CHAIN, A, ACCOUNT_RULE.SPEND, 0n, td));
    const spend = await t.trigger(A, spendTrigger(td, ecdsaParams(s.owner.address), w));
    expect((await t.watch(spend)).state).toBe("included");
    expect(await c.pub.getBalance({ address: to })).toBe(parseEther("0.1"));
    const replay = await t.canTrigger(A, spendTrigger(td, ecdsaParams(s.owner.address), w));
    expect(replay.ready).toBe(false);
    rows.push({ step: "owner spend", account: A, hash: spend, gasUsed: (await c.pub.getTransactionReceipt({ hash: spend })).gasUsed, replay: `${replay.name}: ${replay.reason}` });

    // guardians 0 and 2 rotate the owner; a second vote by guardian 0 in the same round is refused by the protocol
    const newOwner = privateKeyToAccount(generatePrivateKey());
    const proposal = rotationProposal(ecdsaParams(newOwner.address));
    const v0 = await vote(A, s, 0, proposal);
    const again = await t.canTrigger(A, voteTrigger(proposal, v0.nullifierHash, v0.proof));
    expect(again.ready).toBe(false);
    const v2 = await vote(A, s, 2, proposal);
    let st = await state(A);
    expect(st[5]).toBe(proposal);
    await expect(finalizeRecovery(dc, A)).rejects.toThrow();
    await sleep(Number(st[6]) * 1000 - Date.now() + 8_000);
    await finalizeRecovery(dc, A);
    st = await state(A);
    expect(st[0]).toBe(proposal);
    const td2 = spendData(to, parseEther("0.1"));
    const oldTry = await t.canTrigger(A, spendTrigger(td2, ecdsaParams(s.owner.address), await signEcdsaIntent(s.owner, accountBinding(CHAIN, A, ACCOUNT_RULE.SPEND, 1n, td2))));
    expect(oldTry.ready).toBe(false);
    const newSpend = await t.trigger(A, spendTrigger(td2, ecdsaParams(newOwner.address), await signEcdsaIntent(newOwner, accountBinding(CHAIN, A, ACCOUNT_RULE.SPEND, 1n, td2))));
    expect((await t.watch(newSpend)).state).toBe("included");
    rows.push({ step: "guardian rotation", votes: [v0.hash, v2.hash], secondVoteSameGuardian: `${again.name}: ${again.reason}`, oldOwnerAfter: `${oldTry.name}: ${oldTry.reason}`, newOwnerSpend: newSpend });

    // guardians 1 and 2 flip the quantum switch (round 1); owner spends are refused from then on
    const q1 = await vote(A, s, 1, PROPOSAL_QUANTUM);
    const q2 = await vote(A, s, 2, PROPOSAL_QUANTUM);
    st = await state(A);
    expect(st[2]).toBe(true);
    const td3 = spendData(to, parseEther("0.1"));
    const afterSwitch = await t.canTrigger(A, spendTrigger(td3, ecdsaParams(newOwner.address), await signEcdsaIntent(newOwner, accountBinding(CHAIN, A, ACCOUNT_RULE.SPEND, 2n, td3))));
    expect(afterSwitch.ready).toBe(false);

    // only the committed WOTS+ backup key moves the funds, once
    const target = fresh();
    const signer = wotsIntentSigner({ tree: s.backupTree, firstEpoch: 0, binding: { chainId: CHAIN, ruleContract: A, ruleId: ACCOUNT_RULE.MIGRATE }, store: memoryUsageStore(), budget: { maxSteps: 900, maxTries: 400_000 } });
    const mw = signer.sign(accountBinding(CHAIN, A, ACCOUNT_RULE.MIGRATE, 0n, migrateData(target)));
    const before = await c.pub.getBalance({ address: A });
    const mig = await t.trigger(A, migrateTrigger(target, s.backupParams, mw));
    expect((await t.watch(mig)).state).toBe("included");
    const moved = await c.pub.getBalance({ address: target });
    expect(moved > 0n && moved <= before).toBe(true);
    expect((await state(A))[3]).toBe(true);
    rows.push({ step: "quantum switch and migration", quantumVotes: [q1.hash, q2.hash], ownerSpendAfterSwitch: `${afterSwitch.name}: ${afterSwitch.reason}`, migrateHash: mig, migrateGasUsed: (await c.pub.getTransactionReceipt({ hash: mig })).gasUsed, movedWei: moved });
  }, 2_400_000);

  it("a contested guardian takeover opens the forced exit to anyone, and the funds go to the committed exit address", async () => {
    const s = await setup();
    const A = s.d.account;
    const t = c.freshTriggerer().client;
    expect((await t.canTrigger(A, exitTrigger())).ready).toBe(false);
    const attacker = privateKeyToAccount(generatePrivateKey());
    const proposal = rotationProposal(ecdsaParams(attacker.address));
    await vote(A, s, 0, proposal);
    await vote(A, s, 1, proposal);
    const r = await round(A);
    const cw = await signEcdsaIntent(s.owner, accountBinding(CHAIN, A, ACCOUNT_RULE.CONTEST, r, CONTEST_PREIMAGE));
    await contestRecovery(dc, A, ecdsaParams(s.owner.address), cw);
    expect((await state(A))[4]).toBe(true);
    const hash = await t.trigger(A, exitTrigger());
    expect((await t.watch(hash)).state).toBe("included");
    const got = await c.pub.getBalance({ address: s.exitAddress });
    expect(got > parseEther("1.9")).toBe(true);
    rows.push({ step: "contested takeover, forced exit", account: A, exitHash: hash, exitAddressReceived: got });
  }, 1_800_000);

  it.skipIf(!falconOk)("flagship owner: ECDSA + Falcon-512 over the same digest", async () => {
    const guardians = await Promise.all([newIdentity(), newIdentity()]);
    const tree = await MerkleTree.create(20, guardians.map((g) => g.commitment));
    const d = await deploySovereignAccount(dc, c.deployer as never, { owner: "ecdsa+falcon", recoveryDelaySec: 15n });
    const owner = privateKeyToAccount(generatePrivateKey());
    const fk = falconKeygen();
    const params = hybridEcdsaParams(owner.address, d.falconSigner!, fk.params);
    const backupTree = wotsKeygen(generatePrivateKey(), generatePrivateKey());
    await initializeAccount(dc, d.account, { ownerParams: params, exitAddress: fresh(), backupParams: wotsParams(wotsIntentKey(backupTree, 0, CHAIN, ACCOUNT_RULE.MIGRATE)), guardiansRoot: await tree.root(), threshold: 2n });
    const fund = await c.deployer.sendTransaction({ to: d.account, value: parseEther("1"), gas: 100_000n });
    await c.pub.waitForTransactionReceipt({ hash: fund });
    const to = fresh();
    const td = spendData(to, parseEther("0.2"));
    const b = accountBinding(CHAIN, d.account, ACCOUNT_RULE.SPEND, 0n, td);
    const witness = `${await signEcdsaIntent(owner, b)}${falconSignDigest(fk, intentDigest(b)).slice(2)}` as Hex;
    const t = c.freshTriggerer().client;
    const hash = await t.trigger(d.account, spendTrigger(td, params, witness));
    expect((await t.watch(hash)).state).toBe("included");
    expect(await c.pub.getBalance({ address: to })).toBe(parseEther("0.2"));
    const qb = accountBinding(CHAIN, d.account, ACCOUNT_RULE.QUANTUM, 0n, quantumData);
    const qh = await t.trigger(d.account, quantumTrigger(params, `${await signEcdsaIntent(owner, qb)}${falconSignDigest(fk, intentDigest(qb)).slice(2)}` as Hex));
    expect((await t.watch(qh)).state).toBe("included");
    rows.push({ step: "ECDSA + Falcon owner", account: d.account, spendHash: hash, spendGasUsed: (await c.pub.getTransactionReceipt({ hash })).gasUsed, ownerQuantumSwitch: qh });
  }, 1_800_000);
});
