// Writes contracts/test/fixtures/zk-modules.json: deterministic notes, identities and proofs for the Forge tests of the
// private pool, the stealth vault and the guardian recovery, bound to fixed contract addresses (deployCodeTo).
//   bun scripts/gen-fixtures.ts
import { writeFileSync } from "node:fs";
import { keccak256, encodeAbiParameters } from "viem";
import { MerkleTree, membershipProof, newIdentity, newNote, stealthProof, withdrawProof, poseidon } from "../src/index.ts";

const ROOT = new URL("../../../", import.meta.url).pathname;
const POOL = 0x1001n, VAULT = 0x1002n, ACCOUNT = 0x1003n, SPONSOR = 0x1004n;
const RECIPIENT = 0xbeefn, FEE = 10n ** 15n;
const s = (v: bigint) => v.toString();
const field = (h: `0x${string}`) => BigInt(h) >> 8n;

// pool: three deposits, association set = {0, 2}, withdraw note 2
const notes = await Promise.all([1n, 2n, 3n].map((i) => newNote(1000n + i, 2000n + i)));
const pool = await MerkleTree.create(20, notes.map((n) => n.commitment));
const assoc = await MerkleTree.create(20, [notes[0].commitment, notes[2].commitment]);
const w = await withdrawProof({ note: notes[2], pool, poolIndex: 2, assoc, assocIndex: 1, recipient: RECIPIENT, fee: FEE, scope: POOL });
const outside = await MerkleTree.create(20, [notes[1].commitment]); // an association set holding only note 1

// stealth: spend secret, shared secret
const st = await stealthProof({ spendSecret: 4242n, shared: 777n, recipient: RECIPIENT, fee: FEE });

// guardians: 3 hidden guardians, threshold 2. Round 0: guardians 0 and 2 vote to rotate the owner to NEW_OWNER_HASH.
// Round 1: guardians 1 and 2 vote to flip the quantum switch. signal = keccak256(abi.encode(proposal, round)) >> 8,
// externalNullifier = keccak256(abi.encode(account, round)) >> 8 (HiddenGuardians.sol).
const guardians = await Promise.all([11n, 12n, 13n].map((x) => newIdentity(x)));
const gtree = await MerkleTree.create(20, guardians.map((g) => g.commitment));
const NEW_OWNER_HASH = keccak256(encodeAbiParameters([{ type: "string" }], ["owner-2"]));
const QUANTUM = keccak256(encodeAbiParameters([{ type: "string" }], ["quantum"]));
const accountAddr = `0x${ACCOUNT.toString(16).padStart(40, "0")}` as const;
const sig = (proposal: `0x${string}`, round: bigint) => field(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [proposal, round])));
const extOf = (round: bigint) => field(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [accountAddr, round])));
const vote = async (i: number, proposal: `0x${string}`, round: bigint) => {
  const p = await membershipProof({ secret: guardians[i]!.secret, tree: gtree, index: i, signalHash: sig(proposal, round), externalNullifier: extOf(round) });
  return { guardian: i, round: s(round), proposal, nullifierHash: s(p.nullifierHash), proof: p.proof };
};
const rotationVotes = [await vote(0, NEW_OWNER_HASH, 0n), await vote(2, NEW_OWNER_HASH, 0n)];
const quantumVotes = [await vote(1, QUANTUM, 1n), await vote(2, QUANTUM, 1n)];
const staleVote = await vote(1, NEW_OWNER_HASH, 0n); // a round-0 vote, invalid once round 1 opens

// sponsor gate: one member admits account 0x1003
const sponsorExt = field(keccak256(`0x${SPONSOR.toString(16).padStart(40, "0")}`));
const gate = await membershipProof({ secret: guardians[1]!.secret, tree: gtree, index: 1, signalHash: ACCOUNT, externalNullifier: sponsorExt });

const out = {
  addresses: { pool: s(POOL), vault: s(VAULT), account: s(ACCOUNT), sponsor: s(SPONSOR), recipient: s(RECIPIENT) },
  fee: s(FEE),
  pool: {
    commitments: notes.map((n) => s(n.commitment)),
    root: s(await pool.root()),
    assocRoot: s(await assoc.root()),
    outsideAssocRoot: s(await outside.root()),
    nullifierHash: s(w.nullifierHash),
    proof: w.proof,
  },
  stealth: { commitment: s(st.commitment), proof: st.proof },
  guardians: { root: s(await gtree.root()), newOwnerHash: NEW_OWNER_HASH, quantum: QUANTUM, rotationVotes, quantumVotes, staleVote },
  gate: { root: s(await gtree.root()), nullifierHash: s(gate.nullifierHash), externalNullifier: s(sponsorExt), proof: gate.proof },
  emptyRoot: s(await (await MerkleTree.create(20)).root()),
  poseidonCheck: s(await poseidon(1n, 2n)),
};
writeFileSync(`${ROOT}contracts/test/fixtures/zk-modules.json`, JSON.stringify(out, null, 2));
console.log("wrote contracts/test/fixtures/zk-modules.json");
process.exit(0);
