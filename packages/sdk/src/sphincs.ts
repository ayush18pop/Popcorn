// SPHINCS+-style stateless signature, keccak256 truncated to 16 bytes (contracts/src/signers/lib/SphincsLib.sol). OUR OWN construction written from the
// public SPHINCS+ design; NOT the NIST SLH-DSA / SPHINCS+ encoding, no KATs from either (self-generated vectors). See SphincsLib.sol for the
// exact hashing, addressing, parameters ("popcorn-sphincs-keccak-16-h20": n 16, w 16, d 2 x height 10, FORS 26 x 2^8) and the security estimate.
// Stateless: no leaf bookkeeping; up to 2^20 signatures per key. Signing recomputes one bottom-layer tree (1,024 WOTS+ keys: ~0.5M hashes, a few seconds).
import { keccak_256 } from "@noble/hashes/sha3";
import { concat, hexToBytes, keccak256, toHex, type Hex } from "viem";
import { IntentError, StepBudgetExceeded, intentDigest, type IntentBinding } from "./intent.ts";

export const SPHINCS_N = 16;
export const SPHINCS_K = 26;
export const SPHINCS_A = 8;
export const SPHINCS_D = 2;
export const SPHINCS_HP = 10;
export const SPHINCS_LEN = 35;
export const SPHINCS_MAX_SIGNATURES = 2 ** (SPHINCS_D * SPHINCS_HP);
export const SPHINCS_SIG_BYTES = 16 + SPHINCS_K * (1 + SPHINCS_A) * 16 + SPHINCS_D * (SPHINCS_LEN + SPHINCS_HP) * 16; // 5,200

const T_WOTS = 0;
const T_WOTSPK = 1;
const T_TREE = 2;
const T_FORS = 3;
const T_FORSROOTS = 4;
const T_PRF = 0x10;
const LAYER_FORS = 0xff;

interface Addr {
  type: number;
  layer: number;
  tree: bigint;
  kp: number;
  hgt: number;
  idx: number;
}
const addrBig = (a: Addr): bigint => (BigInt(a.type) << 144n) | (BigInt(a.layer) << 136n) | (a.tree << 72n) | (BigInt(a.kp) << 40n) | (BigInt(a.hgt) << 32n) | BigInt(a.idx);
const u256 = (n: bigint): Uint8Array => hexToBytes(toHex(n, { size: 32 }));
const cat = (...p: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(p.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of p) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};
const trunc = (h: Uint8Array): Uint8Array => h.slice(0, 16);
const ZERO16 = new Uint8Array(16);

class Ctx {
  readonly seed: bigint;
  constructor(
    readonly pubSeed: Uint8Array,
    readonly skSeed: Uint8Array,
  ) {
    this.seed = BigInt(toHex(pubSeed));
  }
  tweak(a: Addr): Uint8Array {
    return u256(this.seed ^ addrBig(a));
  }
  F(a: Addr, x: Uint8Array): Uint8Array {
    return trunc(keccak_256(cat(this.tweak(a), x, ZERO16)));
  }
  H(a: Addr, l: Uint8Array, r: Uint8Array): Uint8Array {
    return trunc(keccak_256(cat(this.tweak(a), l, r)));
  }
  C(a: Addr, xs: Uint8Array[]): Uint8Array {
    return trunc(keccak_256(cat(this.tweak(a), ...xs)));
  }
  prf(a: Addr): Uint8Array {
    return trunc(keccak_256(cat(this.skSeed, u256(addrBig({ ...a, type: a.type + T_PRF })))));
  }
  /** chain of F from `from` to `to` steps (address type 0, height = chain, index = step) */
  chain(layer: number, tree: bigint, leaf: number, i: number, x: Uint8Array, from: number, to: number): Uint8Array {
    let cur = x;
    const base = this.seed ^ addrBig({ type: T_WOTS, layer, tree, kp: leaf, hgt: i, idx: 0 });
    for (let s = from; s < to; s++) cur = trunc(keccak_256(cat(u256(base ^ BigInt(s)), cur, ZERO16)));
    return cur;
  }
}

/** The 35 base-16 digits (32 message + 3 checksum) of a 16-byte value. */
export function sphincsDigits(msg16: Uint8Array): number[] {
  const d: number[] = [];
  let csum = 0;
  for (let i = 0; i < 32; i++) {
    const v = i % 2 === 0 ? msg16[i >> 1]! >> 4 : msg16[i >> 1]! & 15;
    d.push(v);
    csum += 15 - v;
  }
  d.push((csum >> 8) & 15, (csum >> 4) & 15, csum & 15);
  return d;
}

interface WotsTree {
  /** levels[0] = leaves (WOTS public keys), levels[HP] = [root] */
  levels: Uint8Array[][];
}
function buildTree(c: Ctx, layer: number, tree: bigint): WotsTree {
  const leaves: Uint8Array[] = [];
  for (let leaf = 0; leaf < 1 << SPHINCS_HP; leaf++) {
    const ends: Uint8Array[] = [];
    for (let i = 0; i < SPHINCS_LEN; i++) ends.push(c.chain(layer, tree, leaf, i, c.prf({ type: T_WOTS, layer, tree, kp: leaf, hgt: i, idx: 0 }), 0, 15));
    leaves.push(c.C({ type: T_WOTSPK, layer, tree, kp: leaf, hgt: 0, idx: 0 }, ends));
  }
  const levels = [leaves];
  for (let h = 1; h <= SPHINCS_HP; h++) {
    const prev = levels[h - 1]!;
    const row: Uint8Array[] = [];
    for (let j = 0; j < prev.length / 2; j++) row.push(c.H({ type: T_TREE, layer, tree, kp: 0, hgt: h, idx: j }, prev[2 * j]!, prev[2 * j + 1]!));
    levels.push(row);
  }
  return { levels };
}

export interface SphincsKey {
  skSeed: Hex;
  pubSeed: Hex;
  /** 16 bytes left-aligned in a bytes32 (the low 16 bytes are zero). */
  root: Hex;
  /** the top layer's tree (cached: every signature needs it) */
  top: WotsTree;
}

/** About 0.5M hashes (a few seconds): builds the top-layer tree, whose root is the public key. */
export function sphincsKeygen(skSeed: Hex, pubSeed: Hex): SphincsKey {
  const c = new Ctx(hexToBytes(pubSeed), hexToBytes(skSeed));
  const top = buildTree(c, SPHINCS_D - 1, 0n);
  return { skSeed, pubSeed, root: toHex(cat(top.levels[SPHINCS_HP]![0]!, ZERO16)), top };
}

/** Params for SphincsSigner: pubSeed ++ root. */
export const sphincsParams = (k: Pick<SphincsKey, "pubSeed" | "root">): Hex => concat([k.pubSeed, k.root]);

function mdOf(pubSeed: Hex, root: Hex, digest: Hex, R: Uint8Array) {
  const md = hexToBytes(keccak256(concat([toHex(R), pubSeed, `0x${root.slice(2, 34)}` as Hex, digest])));
  const idx = ((md[26]! << 16) | (md[27]! << 8) | md[28]!) & 0xfffff;
  return { md, idx };
}

const stepsOfDigits = (d: number[]): number => d.reduce((a, x) => a + 15 - x, 0);

interface SignedWith {
  sig: Hex;
  /** WOTS+ hash steps the verifier runs over both layers (about 117 gas each) */
  steps: number;
}
/** FORS part for randomiser R: the signature pieces, the FORS public key (layer 0's message) and the hypertree position. */
function forsPart(c: Ctx, key: SphincsKey, digest: Hex, R: Uint8Array) {
  const { md, idx } = mdOf(key.pubSeed, key.root, digest, R);
  const tree0 = BigInt(idx >> SPHINCS_HP);
  const leaf0 = idx & 1023;
  const parts: Uint8Array[] = [R];
  const roots: Uint8Array[] = [];
  for (let t = 0; t < SPHINCS_K; t++) {
    const lv: Uint8Array[][] = [[]];
    const fa = (hgt: number, j: number): Addr => ({ type: T_FORS, layer: LAYER_FORS, tree: tree0, kp: leaf0, hgt, idx: (t << 8) | j });
    for (let i = 0; i < 1 << SPHINCS_A; i++) lv[0]!.push(c.F(fa(0, i), c.prf(fa(0, i))));
    for (let h = 1; h <= SPHINCS_A; h++) {
      const prev = lv[h - 1]!;
      const row: Uint8Array[] = [];
      for (let j = 0; j < prev.length / 2; j++) row.push(c.H(fa(h, j), prev[2 * j]!, prev[2 * j + 1]!));
      lv.push(row);
    }
    const i = md[t]!;
    parts.push(c.prf(fa(0, i)));
    for (let h = 0; h < SPHINCS_A; h++) parts.push(lv[h]![(i >> h) ^ 1]!);
    roots.push(lv[SPHINCS_A]![0]!);
  }
  const forsPk = c.C({ type: T_FORSROOTS, layer: LAYER_FORS, tree: tree0, kp: leaf0, hgt: 0, idx: 0 }, roots);
  return { parts, forsPk, idx };
}

function signWith(key: SphincsKey, c: Ctx, digest: Hex, fp: ReturnType<typeof forsPart>, onLayer0Steps?: (steps0: number) => boolean): SignedWith | null {
  const parts = [...fp.parts];
  let msg = fp.forsPk;
  let steps = 0;
  for (let l = 0; l < SPHINCS_D; l++) {
    const tree = BigInt(fp.idx >> (SPHINCS_HP * (l + 1)));
    const leaf = (fp.idx >> (SPHINCS_HP * l)) & 1023;
    const d = sphincsDigits(msg);
    steps += stepsOfDigits(d);
    if (l === 0 && onLayer0Steps && !onLayer0Steps(steps)) return null; // too expensive: skip the 1,024-leaf tree build
    const t = l === SPHINCS_D - 1 && tree === 0n ? key.top : buildTree(c, l, tree);
    for (let i = 0; i < SPHINCS_LEN; i++) parts.push(c.chain(l, tree, leaf, i, c.prf({ type: T_WOTS, layer: l, tree, kp: leaf, hgt: i, idx: 0 }), 0, d[i]!));
    for (let h = 0; h < SPHINCS_HP; h++) parts.push(t.levels[h]![(leaf >> h) ^ 1]!);
    msg = t.levels[SPHINCS_HP]![0]!;
  }
  return { sig: toHex(cat(...parts)), steps };
}

export interface SphincsBudget {
  /**
   * The most WOTS+ hash steps (both layers; about 117 gas each) the signature may need. The verifier costs about 128k + 117 x steps in a rule contract
   *; a random digest averages ~525 steps over the two layers. The signer grinds the randomiser R until the
   * signature fits and THROWS StepBudgetExceeded if none does, instead of returning an over-budget signature.
   */
  maxSteps: number;
  /** randomisers tried (each costs a FORS computation, ~0.1 s; a full hypertree build, ~3 s, only for promising ones). Default 400. */
  maxTries?: number;
}
/** Signs `digest`. Without a budget it signs with the first randomiser (the verifier cost then depends on the digest). */
export function sphincsSign(key: SphincsKey, digest: Hex, budget?: SphincsBudget): Hex {
  const c = new Ctx(hexToBytes(key.pubSeed), hexToBytes(key.skSeed));
  const R = (i: number): Uint8Array => hexToBytes(keccak256(concat([key.skSeed, digest, toHex(i, { size: 4 })]))).slice(0, 16);
  if (!budget) return signWith(key, c, digest, forsPart(c, key, digest, R(0)))!.sig;
  const max = budget.maxTries ?? 400;
  let best: SignedWith | null = null;
  let builds = 0;
  for (let i = 0; i < max && builds < 25; i++) {
    const fp = forsPart(c, key, digest, R(i));
    // layer 0's steps are known from the FORS key alone: skip candidates that cannot fit even with a cheap layer 1 (the minimum seen is about 150)
    const r = signWith(key, c, digest, fp, (s0) => s0 + 150 <= budget.maxSteps);
    if (!r) continue;
    builds++;
    if (!best || r.steps < best.steps) best = r;
    if (r.steps <= budget.maxSteps) return r.sig;
  }
  throw new StepBudgetExceeded(best?.steps ?? Number.POSITIVE_INFINITY, budget.maxSteps, max);
}

/** The verifier's hash steps for a signature (both layers). */
export function sphincsSteps(pubSeed: Hex, root: Hex, digest: Hex, sig: Hex): number {
  const e = hexToBytes(sig);
  const c = new Ctx(hexToBytes(pubSeed), new Uint8Array(32));
  const { md, idx } = mdOf(pubSeed, root, digest, e.slice(0, 16));
  const tree0 = BigInt(idx >> SPHINCS_HP);
  const leaf0 = idx & 1023;
  const roots: Uint8Array[] = [];
  for (let t = 0; t < SPHINCS_K; t++) {
    const off = 16 + t * 144;
    const i = md[t]!;
    const fa = (hgt: number, j: number): Addr => ({ type: T_FORS, layer: LAYER_FORS, tree: tree0, kp: leaf0, hgt, idx: (t << 8) | j });
    let node = c.F(fa(0, i), e.slice(off, off + 16));
    for (let h = 0; h < SPHINCS_A; h++) {
      const sib = e.slice(off + 16 + 16 * h, off + 32 + 16 * h);
      const [l, r] = ((i >> h) & 1) === 0 ? [node, sib] : [sib, node];
      node = c.H(fa(h + 1, i >> (h + 1)), l, r);
    }
    roots.push(node);
  }
  let msg = c.C({ type: T_FORSROOTS, layer: LAYER_FORS, tree: tree0, kp: leaf0, hgt: 0, idx: 0 }, roots);
  let lo = 16 + SPHINCS_K * 144;
  let steps = 0;
  for (let l = 0; l < SPHINCS_D; l++) {
    const tree = BigInt(idx >> (SPHINCS_HP * (l + 1)));
    const leaf = (idx >> (SPHINCS_HP * l)) & 1023;
    const d = sphincsDigits(msg);
    steps += stepsOfDigits(d);
    const ends: Uint8Array[] = [];
    for (let i = 0; i < SPHINCS_LEN; i++) ends.push(c.chain(l, tree, leaf, i, e.slice(lo + 16 * i, lo + 16 * i + 16), d[i]!, 15));
    let node = c.C({ type: T_WOTSPK, layer: l, tree, kp: leaf, hgt: 0, idx: 0 }, ends);
    for (let h = 0; h < SPHINCS_HP; h++) {
      const sib = e.slice(lo + 560 + 16 * h, lo + 576 + 16 * h);
      const [a, b] = ((leaf >> h) & 1) === 0 ? [node, sib] : [sib, node];
      node = c.H({ type: T_TREE, layer: l, tree, kp: 0, hgt: h + 1, idx: leaf >> (h + 1) }, a, b);
    }
    msg = node;
    lo += 720;
  }
  return steps;
}

/** Reference verifier (mirrors SphincsLib). */
export function sphincsVerify(pubSeed: Hex, root: Hex, digest: Hex, sig: Hex): boolean {
  const e = hexToBytes(sig);
  if (e.length !== SPHINCS_SIG_BYTES || BigInt(root) & ((1n << 128n) - 1n)) return false;
  const c = new Ctx(hexToBytes(pubSeed), new Uint8Array(32));
  const R = e.slice(0, 16);
  const { md, idx } = mdOf(pubSeed, root, digest, R);
  const tree0 = BigInt(idx >> SPHINCS_HP);
  const leaf0 = idx & 1023;
  const roots: Uint8Array[] = [];
  for (let t = 0; t < SPHINCS_K; t++) {
    const off = 16 + t * 144;
    const i = md[t]!;
    const fa = (hgt: number, j: number): Addr => ({ type: T_FORS, layer: LAYER_FORS, tree: tree0, kp: leaf0, hgt, idx: (t << 8) | j });
    let node = c.F(fa(0, i), e.slice(off, off + 16));
    for (let h = 0; h < SPHINCS_A; h++) {
      const sib = e.slice(off + 16 + 16 * h, off + 32 + 16 * h);
      const [l, r] = ((i >> h) & 1) === 0 ? [node, sib] : [sib, node];
      node = c.H(fa(h + 1, i >> (h + 1)), l, r);
    }
    roots.push(node);
  }
  let msg = c.C({ type: T_FORSROOTS, layer: LAYER_FORS, tree: tree0, kp: leaf0, hgt: 0, idx: 0 }, roots);
  let lo = 16 + SPHINCS_K * 144;
  for (let l = 0; l < SPHINCS_D; l++) {
    const tree = BigInt(idx >> (SPHINCS_HP * (l + 1)));
    const leaf = (idx >> (SPHINCS_HP * l)) & 1023;
    const d = sphincsDigits(msg);
    const ends: Uint8Array[] = [];
    for (let i = 0; i < SPHINCS_LEN; i++) ends.push(c.chain(l, tree, leaf, i, e.slice(lo + 16 * i, lo + 16 * i + 16), d[i]!, 15));
    let node = c.C({ type: T_WOTSPK, layer: l, tree, kp: leaf, hgt: 0, idx: 0 }, ends);
    for (let h = 0; h < SPHINCS_HP; h++) {
      const sib = e.slice(lo + 560 + 16 * h, lo + 576 + 16 * h);
      const [a, b] = ((leaf >> h) & 1) === 0 ? [node, sib] : [sib, node];
      node = c.H({ type: T_TREE, layer: l, tree, kp: 0, hgt: h + 1, idx: leaf >> (h + 1) }, a, b);
    }
    msg = node;
    lo += 720;
  }
  return toHex(cat(msg, ZERO16)) === root.toLowerCase();
}

export interface SphincsIntentSignerOptions {
  key: SphincsKey;
  /** REQUIRED: the signer never returns a signature that needs more verifier work than this (see SphincsBudget). */
  budget: SphincsBudget;
}
/** Stateless: nothing to persist. Signing takes a few seconds per randomiser that gets a full tree build (one bottom-layer tree of 1,024 WOTS+ keys). */
export function sphincsIntentSigner(o: SphincsIntentSignerOptions) {
  if (!o.budget || !(o.budget.maxSteps > 0)) throw new IntentError("sphincsIntentSigner: pass `budget: { maxSteps }`");
  const signDigest = (digest: Hex): Hex => sphincsSign(o.key, digest, o.budget);
  return { params: sphincsParams(o.key), signDigest, sign: (b: IntentBinding) => signDigest(intentDigest(b)) };
}
