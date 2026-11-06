// Proving helpers for the membership, withdraw and stealth circuits: Poseidon, the incremental Merkle tree the contracts
// keep (same zero values, same hashing), and proofs encoded the way the generated verifiers read them.
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
// @ts-ignore no types shipped
import * as snarkjs from "snarkjs";
// @ts-ignore no types shipped
import { buildBn128 } from "ffjavascript";
// @ts-ignore no types shipped
import { buildPoseidon, poseidonContract } from "circomlibjs";

const ZK = new URL("../", import.meta.url).pathname;

/** BN254 scalar field: every circuit value is an element of it. */
export const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const TREE_DEPTH = 20;

export type Circuit = "membership" | "withdraw" | "stealth";
export const circuitFiles = (c: Circuit) => ({ wasm: `${ZK}build/${c}_js/${c}.wasm`, zkey: `${ZK}setup/${c}_final.zkey`, vkey: `${ZK}setup/${c}_vkey.json` });

// Bun cannot run ffjavascript's worker pool; one single-threaded curve, cached where snarkjs looks for it.
let curveReady: Promise<void> | null = null;
function ensureCurve(): Promise<void> {
  const g = globalThis as { curve_bn128?: { terminate: () => Promise<void> } };
  if (g.curve_bn128) return Promise.resolve();
  curveReady ??= buildBn128(true).then((c: { terminate: () => Promise<void> }) => {
    c.terminate = async () => {};
    g.curve_bn128 = c;
  });
  return curveReady!;
}

// ---------------------------------------------------------------- Poseidon

type PoseidonFn = ((xs: bigint[]) => Uint8Array) & { F: { toObject: (x: Uint8Array) => bigint } };
let poseidonP: Promise<PoseidonFn> | null = null;
const getPoseidon = () => (poseidonP ??= buildPoseidon() as Promise<PoseidonFn>);

/** Poseidon over BN254, the circomlib parameters the circuits and the on-chain Poseidon contract use. */
export async function poseidon(...xs: bigint[]): Promise<bigint> {
  const p = await getPoseidon();
  return p.F.toObject(p(xs));
}

/** Creation code of circomlib's Poseidon contract for `n` inputs: `poseidon(uint256[n]) returns (uint256)`. */
export const poseidonCreationCode = (n: 1 | 2): `0x${string}` => poseidonContract.createCode(n) as `0x${string}`;

/** A random field element (secrets, nullifiers). */
export const randomField = (): bigint => BigInt(`0x${randomBytes(32).toString("hex")}`) % R;

// ---------------------------------------------------------------- the incremental Merkle tree

/** zeros[0] = 0, zeros[i] = Poseidon(zeros[i-1], zeros[i-1]): the empty subtree at each level. */
export async function zeroValues(depth = TREE_DEPTH): Promise<bigint[]> {
  const z = [0n];
  for (let i = 1; i <= depth; i++) z.push(await poseidon(z[i - 1]!, z[i - 1]!));
  return z;
}

/** The append-only Poseidon tree the contracts keep (leaf i at index i, empty leaves 0). */
export class MerkleTree {
  readonly leaves: bigint[] = [];
  private constructor(readonly depth: number, private readonly zeros: bigint[]) {}
  static async create(depth = TREE_DEPTH, leaves: bigint[] = []): Promise<MerkleTree> {
    const t = new MerkleTree(depth, await zeroValues(depth));
    t.leaves.push(...leaves);
    return t;
  }
  insert(leaf: bigint): number {
    this.leaves.push(leaf);
    return this.leaves.length - 1;
  }
  private async layers(): Promise<bigint[][]> {
    const out: bigint[][] = [this.leaves.slice()];
    for (let lvl = 0; lvl < this.depth; lvl++) {
      const cur = out[lvl]!;
      const next: bigint[] = [];
      for (let i = 0; i < Math.ceil(cur.length / 2); i++) next.push(await poseidon(cur[2 * i]!, cur[2 * i + 1] ?? this.zeros[lvl]!));
      out.push(next);
    }
    return out;
  }
  async root(): Promise<bigint> {
    if (this.leaves.length === 0) return this.zeros[this.depth]!;
    return (await this.layers())[this.depth]![0]!;
  }
  async path(index: number): Promise<{ pathElements: bigint[]; pathIndices: number[]; root: bigint }> {
    if (index < 0 || index >= this.leaves.length) throw new Error(`no leaf ${index}`);
    const L = await this.layers();
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let i = index;
    for (let lvl = 0; lvl < this.depth; lvl++) {
      const sib = i ^ 1;
      pathElements.push(L[lvl]![sib] ?? this.zeros[lvl]!);
      pathIndices.push(i & 1);
      i >>= 1;
    }
    return { pathElements, pathIndices, root: L[this.depth]![0]! };
  }
}

// ---------------------------------------------------------------- proofs

export interface Proof {
  /** 256 bytes in the verifiers' order: A.x, A.y, B.x.im, B.x.re, B.y.im, B.y.re, C.x, C.y. */
  proof: `0x${string}`;
  publicSignals: bigint[];
}

const word = (v: bigint | string) => BigInt(v).toString(16).padStart(64, "0");

/** Groth16 proof for `circuit` with the given witness inputs (decimal strings or bigints). */
export async function prove(circuit: Circuit, input: Record<string, unknown>): Promise<Proof> {
  const f = circuitFiles(circuit);
  if (!existsSync(f.wasm)) throw new Error(`${f.wasm} missing: run \`bun run build\` in packages/zk`);
  await ensureCurve();
  const norm = JSON.parse(JSON.stringify(input, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(norm, f.wasm, f.zkey);
  const hex = [proof.pi_a[0], proof.pi_a[1], proof.pi_b[0][1], proof.pi_b[0][0], proof.pi_b[1][1], proof.pi_b[1][0], proof.pi_c[0], proof.pi_c[1]].map(word).join("");
  return { proof: `0x${hex}`, publicSignals: (publicSignals as string[]).map(BigInt) };
}

/** Checks a proof off-chain against the circuit's verifying key. */
export async function verifyOffchain(circuit: Circuit, p: Proof): Promise<boolean> {
  await ensureCurve();
  const vk = await Bun.file(circuitFiles(circuit).vkey).json();
  const w = (i: number) => BigInt(`0x${p.proof.slice(2 + 64 * i, 66 + 64 * i)}`).toString();
  const proof = { pi_a: [w(0), w(1), "1"], pi_b: [[w(3), w(2)], [w(5), w(4)], ["1", "0"]], pi_c: [w(6), w(7), "1"], protocol: "groth16", curve: "bn128" };
  return snarkjs.groth16.verify(vk, p.publicSignals.map(String), proof);
}

// ---------------------------------------------------------------- membership

/** A member's identity: the secret stays with the member, the commitment goes in the set. */
export async function newIdentity(secret = randomField()) {
  return { secret, commitment: await poseidon(secret) };
}

export async function membershipProof(a: { secret: bigint; tree: MerkleTree; index: number; signalHash: bigint; externalNullifier: bigint }) {
  const { pathElements, pathIndices, root } = await a.tree.path(a.index);
  const nullifierHash = await poseidon(a.secret, a.externalNullifier);
  const p = await prove("membership", { root, nullifierHash, signalHash: a.signalHash % R, externalNullifier: a.externalNullifier, secret: a.secret, pathElements, pathIndices });
  return { ...p, root, nullifierHash };
}

// ---------------------------------------------------------------- private pool

/** A deposit note. Keep `nullifier` and `secret`; the pool only ever sees `commitment`. */
export async function newNote(nullifier = randomField(), secret = randomField()) {
  return { nullifier, secret, commitment: await poseidon(nullifier, secret) };
}

export async function withdrawProof(a: { note: { nullifier: bigint; secret: bigint }; pool: MerkleTree; poolIndex: number; assoc: MerkleTree; assocIndex: number; recipient: bigint; fee: bigint; scope: bigint }) {
  const p1 = await a.pool.path(a.poolIndex);
  const p2 = await a.assoc.path(a.assocIndex);
  const nullifierHash = await poseidon(a.note.nullifier, a.scope);
  const p = await prove("withdraw", {
    root: p1.root, assocRoot: p2.root, nullifierHash, recipient: a.recipient, fee: a.fee, scope: a.scope,
    nullifier: a.note.nullifier, secret: a.note.secret,
    pathElements: p1.pathElements, pathIndices: p1.pathIndices, assocPathElements: p2.pathElements, assocPathIndices: p2.pathIndices,
  });
  return { ...p, root: p1.root, assocRoot: p2.root, nullifierHash };
}

// ---------------------------------------------------------------- stealth

/** C = Poseidon(Poseidon(spendSecret), shared). */
export async function stealthCommitment(spendTag: bigint, shared: bigint) {
  return poseidon(spendTag, shared % R);
}

export async function stealthProof(a: { spendSecret: bigint; shared: bigint; recipient: bigint; fee: bigint }) {
  const commitment = await stealthCommitment(await poseidon(a.spendSecret), a.shared);
  const p = await prove("stealth", { commitment, recipient: a.recipient, fee: a.fee, spendSecret: a.spendSecret, shared: a.shared % R });
  return { ...p, commitment };
}
export * from "./exploit.ts";
