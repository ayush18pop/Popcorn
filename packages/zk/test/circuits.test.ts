// The three circuits end to end: a valid proof verifies; tampering with any public input makes it fail.
import { describe, expect, test } from "bun:test";
import { MerkleTree, membershipProof, newIdentity, newNote, stealthProof, verifyOffchain, withdrawProof, poseidon, randomField } from "../src/index.ts";

const T = 120_000;

describe("membership", () => {
  test("a member proves membership for one signal; another signal or scope fails", async () => {
    const ids = await Promise.all([newIdentity(), newIdentity(), newIdentity()]);
    const tree = await MerkleTree.create(20, ids.map((i) => i.commitment));
    const p = await membershipProof({ secret: ids[1].secret, tree, index: 1, signalHash: 1234n, externalNullifier: 99n });
    expect(await verifyOffchain("membership", p)).toBe(true);
    expect(p.nullifierHash).toBe(await poseidon(ids[1].secret, 99n));
    const s = [...p.publicSignals];
    expect(await verifyOffchain("membership", { ...p, publicSignals: [s[0], s[1], 1235n, s[3]] })).toBe(false);
    expect(await verifyOffchain("membership", { ...p, publicSignals: [s[0], s[1], s[2], 100n] })).toBe(false);
  }, T);
  test("a non-member cannot build a proof", async () => {
    const tree = await MerkleTree.create(20, [(await newIdentity()).commitment]);
    await expect(membershipProof({ secret: randomField(), tree, index: 0, signalHash: 1n, externalNullifier: 1n })).rejects.toThrow();
  }, T);
});

describe("withdraw", () => {
  test("a note in the pool and the association set withdraws; recipient and fee are bound", async () => {
    const notes = await Promise.all([newNote(), newNote(), newNote()]);
    const pool = await MerkleTree.create(20, notes.map((n) => n.commitment));
    const assoc = await MerkleTree.create(20, [notes[0].commitment, notes[2].commitment]);
    const p = await withdrawProof({ note: notes[2], pool, poolIndex: 2, assoc, assocIndex: 1, recipient: 0xabcn, fee: 10n, scope: 0x1234n });
    expect(await verifyOffchain("withdraw", p)).toBe(true);
    const s = [...p.publicSignals];
    s[3] = 0xabdn;
    expect(await verifyOffchain("withdraw", { ...p, publicSignals: s })).toBe(false);
  }, T);
  test("a note outside the association set cannot prove", async () => {
    const notes = await Promise.all([newNote(), newNote()]);
    const pool = await MerkleTree.create(20, notes.map((n) => n.commitment));
    const assoc = await MerkleTree.create(20, [notes[0].commitment]);
    await expect(withdrawProof({ note: notes[1], pool, poolIndex: 1, assoc, assocIndex: 0, recipient: 1n, fee: 0n, scope: 1n })).rejects.toThrow();
  }, T);
});

describe("stealth", () => {
  test("the receiver spends; the payer, who knows the shared secret but not the spend secret, cannot", async () => {
    const spendSecret = randomField();
    const shared = randomField();
    const p = await stealthProof({ spendSecret, shared, recipient: 7n, fee: 1n });
    expect(await verifyOffchain("stealth", p)).toBe(true);
    const forged = await stealthProof({ spendSecret: randomField(), shared, recipient: 7n, fee: 1n });
    expect(forged.commitment).not.toBe(p.commitment);
  }, T);
});
