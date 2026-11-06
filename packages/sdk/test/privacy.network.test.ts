// Private pool and stealth vault on the local devnet: real deposits, real Groth16 proofs, withdrawals and spends sent by
// a key with no ETH to a recipient with no ETH, paid by the pool or the vault.
//   POPCORN_NETWORK=1 bun run --cwd packages/sdk vitest run test/privacy.network.test.ts --reporter verbose
// Keys: dev-1 deploys and is the association-set provider; dev-2 deposits and pays.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MerkleTree, newNote, poseidon, stealthCommitment, stealthProof, withdrawProof, randomField } from "@popcorn/zk";
import {
  deployPrivatePool,
  deployStealthVault,
  poolCommitments,
  poolDeposit,
  poolWithdrawal,
  prepareStealthPayment,
  scanStealth,
  setAssociationRoot,
  stealthAnnouncements,
  stealthKeys,
  stealthMetaAddress,
  stealthPay,
  stealthSpend,
  privatePoolAbi,
} from "../src/index.ts";
import { RESULTS, WANTED, chain, chainUp, j, keyFile, loadKey, makeClients } from "./intent.helpers.ts";

const ON = WANTED && (await chainUp()) && existsSync(keyFile(1)) && existsSync(keyFile(2));
const rows: Record<string, unknown>[] = [];
const fresh = () => privateKeyToAccount(generatePrivateKey()).address;

describe.skipIf(!ON)("Private pool and stealth vault on the local devnet", () => {
  const c = ON ? makeClients(loadKey(1)) : (undefined as never);
  const payerAcct = ON ? privateKeyToAccount(loadKey(2)) : (undefined as never);
  const payer = ON ? { wallet: createWalletClient({ account: payerAcct, chain, transport: http() }), pub: c.pub } : (undefined as never);
  const dc = ON ? { wallet: c.deployer, pub: c.pub } : (undefined as never);
  afterAll(() => {
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(`${RESULTS}privacy.json`, JSON.stringify(j({ chain: "local (1338)", rows }), null, 2));
  });

  it("private pool: three deposits, an association set, a withdrawal to an empty address paid by the pool; replay and outsiders refused", async () => {
    const p = await deployPrivatePool(dc, c.deployer as never, { denomination: parseEther("1"), associationProvider: c.account.address });
    rows.push({ step: "pool deployed", pool: p.pool, minFee: p.minFee });
    const notes = await Promise.all([newNote(), newNote(), newNote()]);
    for (const n of notes) await poolDeposit(payer as never, p.pool, n.commitment, p.denomination);
    const leaves = await poolCommitments(c.pub as never, p.pool);
    expect(leaves).toEqual(notes.map((n) => n.commitment));
    const tree = await MerkleTree.create(20, leaves);
    expect(await c.pub.readContract({ address: p.pool, abi: privatePoolAbi, functionName: "currentRoot" })).toBe(await tree.root());
    // the provider accepts deposits 0 and 2 (deposit 1 is "flagged")
    const assoc = await MerkleTree.create(20, [notes[0]!.commitment, notes[2]!.commitment]);
    await setAssociationRoot(dc, p.pool, await assoc.root(), true);

    const recipient = fresh();
    const w = await withdrawProof({ note: notes[2]!, pool: tree, poolIndex: 2, assoc, assocIndex: 1, recipient: BigInt(recipient), fee: p.minFee, scope: BigInt(p.pool) });
    const trig = poolWithdrawal({ ...w, recipient, fee: p.minFee });
    const t = c.freshTriggerer().client;
    const ready = await t.canTrigger(p.pool, trig);
    expect(ready.ready).toBe(true);
    const hash = await t.trigger(p.pool, trig);
    expect((await t.watch(hash)).state).toBe("included");
    const receipt = await c.pub.getTransactionReceipt({ hash });
    expect(await c.pub.getBalance({ address: recipient })).toBe(p.denomination - p.minFee);
    rows.push({ step: "withdrawal", hash, gasUsed: receipt.gasUsed, recipientReceived: p.denomination - p.minFee, triggererEth: 0, recipientEthBefore: 0, canonical: ready.canonical });

    const replay = await t.canTrigger(p.pool, trig);
    expect(replay.ready).toBe(false);
    // the flagged deposit cannot prove membership in the association set at all
    await expect(withdrawProof({ note: notes[1]!, pool: tree, poolIndex: 1, assoc, assocIndex: 0, recipient: BigInt(recipient), fee: p.minFee, scope: BigInt(p.pool) })).rejects.toThrow();
    // a proof redirected to another recipient is refused
    const other = poolWithdrawal({ ...(await withdrawProof({ note: notes[0]!, pool: tree, poolIndex: 0, assoc, assocIndex: 0, recipient: BigInt(recipient), fee: p.minFee, scope: BigInt(p.pool) })), recipient: fresh(), fee: p.minFee });
    const redirected = await t.canTrigger(p.pool, other);
    expect(redirected.ready).toBe(false);
    rows.push({ step: "refusals", replay: `${replay.name}: ${replay.reason}`, redirected: `${redirected.name}: ${redirected.reason}`, flaggedDeposit: "no proof exists (not in the association set)" });
  }, 1_200_000);

  it("stealth: pay to an ML-KEM meta-address, the receiver finds it by scanning and spends to an empty address; the vault pays", async () => {
    const v = await deployStealthVault(dc, c.deployer as never);
    const spendSecret = randomField();
    const keys = stealthKeys(spendSecret, await poseidon(spendSecret));
    const meta = stealthMetaAddress(keys);
    // two payments to the receiver, one to someone else
    const otherKeys = stealthKeys(randomField(), await poseidon(randomField()));
    const pays = [await prepareStealthPayment(meta, stealthCommitment), await prepareStealthPayment(stealthMetaAddress(otherKeys), stealthCommitment), await prepareStealthPayment(meta, stealthCommitment)];
    for (const [i, p] of pays.entries()) await stealthPay(payer as never, v.vault, p, parseEther(i === 2 ? "0.7" : "0.5"));
    const found = await scanStealth(keys, await stealthAnnouncements(c.pub as never, v.vault), stealthCommitment);
    expect(found.map((f) => f.commitment).sort()).toEqual([pays[0]!.commitment, pays[2]!.commitment].sort());

    const recipient = fresh();
    const mine = found.find((f) => f.commitment === pays[2]!.commitment)!;
    const proof = await stealthProof({ spendSecret, shared: mine.shared, recipient: BigInt(recipient), fee: v.minFee });
    expect(proof.commitment).toBe(mine.commitment);
    const trig = stealthSpend({ commitment: mine.commitment, recipient, fee: v.minFee, proof: proof.proof as Hex });
    const t = c.freshTriggerer().client;
    const hash = await t.trigger(v.vault, trig);
    expect((await t.watch(hash)).state).toBe("included");
    expect(await c.pub.getBalance({ address: recipient })).toBe(parseEther("0.7") - v.minFee);
    const receipt = await c.pub.getTransactionReceipt({ hash });

    // the payer knows the shared secret but not the spend secret: it cannot build a proof for the commitment
    const payerTry = await stealthProof({ spendSecret: randomField(), shared: mine.shared, recipient: BigInt(recipient), fee: v.minFee });
    expect(payerTry.commitment).not.toBe(mine.commitment);
    const second = await t.canTrigger(v.vault, trig);
    expect(second.ready).toBe(false);
    rows.push({ step: "stealth spend", vault: v.vault, hash, gasUsed: receipt.gasUsed, announcementsScanned: 3, found: found.length, secondSpend: `${second.name}: ${second.reason}` });
  }, 1_200_000);
});

export type { Address };
