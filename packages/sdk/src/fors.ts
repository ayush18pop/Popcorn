// FORS few-time signature, keccak256, n = 32, k = 24 trees of height 8 (contracts/src/signers/lib/ForsLib.sol; OUR OWN construction in the
// style of SPHINCS+ FORS, not the SPHINCS+ spec's hashing or encodings; self-generated test vectors only).
//   tweak T(t, level, node) = pubSeed XOR (t << 48 | level << 40 | node)
//   leaf = keccak256(T(t,0,i) ++ sk(t,i))   node = keccak256(T(t,l,j) ++ left ++ right)   sk(t,i) = keccak256(skSeed ++ t ++ i)
//   pk = keccak256((pubSeed XOR 1<<200) ++ root_0 ++ ... ++ root_23)
//   md = keccak256(pubSeed ++ salt ++ message); tree t opens leaf byte t of md
//   signature = salt (32) ++ 24 x ( secret leaf (32) ++ 8 auth nodes ) = 6,944 bytes
// A FEW-TIME key: every signature reveals one leaf per tree; after r signatures a new message is forged with probability ~ (r/256)^24.
// The predicate accepts 8 epochs per key (firstEpoch .. firstEpoch + 7) and the SDK signer refuses a ninth and a second digest per epoch.
import { concat, hexToBytes, keccak256, toHex, type Hex } from "viem";
import { SignatureBudgetExhausted, IntentError, assertBinding, claimLeaf, type IntentKeyBinding, type UsageStore } from "./intent.ts";
import { intentDigest, type IntentBinding } from "./intent.ts";

export const FORS_K = 24;
export const FORS_A = 8;
export const FORS_MAX_SIGNATURES = 8;
export const FORS_SIG_BYTES = 32 + FORS_K * 32 * (1 + FORS_A);

const k = (b: Uint8Array): Uint8Array => hexToBytes(keccak256(b));
const u256 = (n: bigint): Uint8Array => hexToBytes(toHex(n, { size: 32 }));
const tweak = (seed: bigint, t: number, level: number, node: number): Uint8Array => u256(seed ^ ((BigInt(t) << 48n) | (BigInt(level) << 40n) | BigInt(node)));
const cat = (...p: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(p.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of p) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};

export interface ForsKey {
  skSeed: Hex;
  pubSeed: Hex;
  /** Public key: the hash of the 24 roots. */
  pk: Hex;
  /** levels[t][l][j]: tree t, level l (0 = leaves), node j. */
  levels: Uint8Array[][][];
}

export function forsKeygen(skSeed: Hex, pubSeed: Hex): ForsKey {
  const seed = BigInt(pubSeed);
  const sk = hexToBytes(skSeed);
  const levels: Uint8Array[][][] = [];
  const roots: Uint8Array[] = [];
  for (let t = 0; t < FORS_K; t++) {
    const lv: Uint8Array[][] = [[]];
    for (let i = 0; i < 1 << FORS_A; i++) lv[0]!.push(k(cat(tweak(seed, t, 0, i), forsSk(sk, t, i))));
    for (let l = 1; l <= FORS_A; l++) {
      const prev = lv[l - 1]!;
      const row: Uint8Array[] = [];
      for (let j = 0; j < prev.length / 2; j++) row.push(k(cat(tweak(seed, t, l, j), prev[2 * j]!, prev[2 * j + 1]!)));
      lv.push(row);
    }
    levels.push(lv);
    roots.push(lv[FORS_A]![0]!);
  }
  return { skSeed, pubSeed, pk: toHex(k(cat(u256(seed ^ (1n << 200n)), ...roots))), levels };
}
const forsSk = (sk: Uint8Array, t: number, i: number): Uint8Array => k(cat(sk, u256(BigInt(t)), u256(BigInt(i))));

/** The signed message's 24 leaf indexes and md. */
export const forsIndices = (pubSeed: Hex, salt: Hex, message: Hex): number[] => Array.from(hexToBytes(keccak256(concat([pubSeed, salt, message])))).slice(0, FORS_K);

export function forsSign(key: ForsKey, message: Hex, salt: Hex): Hex {
  const sk = hexToBytes(key.skSeed);
  const idx = forsIndices(key.pubSeed, salt, message);
  const parts: Uint8Array[] = [hexToBytes(salt)];
  for (let t = 0; t < FORS_K; t++) {
    const i = idx[t]!;
    parts.push(forsSk(sk, t, i));
    for (let l = 0; l < FORS_A; l++) parts.push(key.levels[t]![l]![(i >> l) ^ 1]!);
  }
  return toHex(cat(...parts));
}

/** Reference verifier (mirrors ForsLib). */
export function forsVerify(pk: Hex, pubSeed: Hex, message: Hex, sig: Hex): boolean {
  const e = hexToBytes(sig);
  if (e.length !== FORS_SIG_BYTES) return false;
  const seed = BigInt(pubSeed);
  const idx = forsIndices(pubSeed, toHex(e.slice(0, 32)), message);
  const roots: Uint8Array[] = [];
  for (let t = 0; t < FORS_K; t++) {
    const off = 32 + t * 32 * (1 + FORS_A);
    const i = idx[t]!;
    let node = k(cat(tweak(seed, t, 0, i), e.slice(off, off + 32)));
    for (let l = 0; l < FORS_A; l++) {
      const sib = e.slice(off + 32 + 32 * l, off + 64 + 32 * l);
      const [left, right] = ((i >> l) & 1) === 0 ? [node, sib] : [sib, node];
      node = k(cat(tweak(seed, t, l + 1, i >> (l + 1)), left, right));
    }
    roots.push(node);
  }
  return toHex(k(cat(u256(seed ^ (1n << 200n)), ...roots))) === pk.toLowerCase();
}

export interface ForsIntentSignerOptions {
  key: ForsKey;
  /** ruleEpoch of signature number 0; valid epochs are firstEpoch .. firstEpoch + 7. */
  firstEpoch: bigint | number;
  /** The one (chainId, rule contract, ruleId) this key serves (bound on chain to the chain and rule, in the signer's store to the rule contract too). */
  binding: IntentKeyBinding;
  store: UsageStore;
}
/** Params for ForsSigner: pk ++ pubSeed ++ firstEpoch ++ chainId ++ ruleId. */
export const forsParams = (key: Pick<ForsKey, "pk" | "pubSeed">, firstEpoch: bigint | number, chainId: bigint | number, ruleId: bigint | number): Hex =>
  concat([key.pk, key.pubSeed, toHex(BigInt(firstEpoch), { size: 32 }), toHex(BigInt(chainId), { size: 32 }), toHex(BigInt(ruleId), { size: 32 })]);

export function forsIntentSigner(o: ForsIntentSignerOptions) {
  if (!o.store) throw new IntentError("forsIntentSigner: pass a `store` (fileUsageStore)");
  const first = BigInt(o.firstEpoch);
  const signDigest = (digest: Hex, ruleEpoch: bigint | number): Hex => {
    const e = BigInt(ruleEpoch);
    if (e < first) throw new IntentError(`ruleEpoch ${e} is below firstEpoch ${first}`);
    const n = Number(e - first);
    if (n >= FORS_MAX_SIGNATURES) throw new SignatureBudgetExhausted(n, FORS_MAX_SIGNATURES, "FORS");
    claimLeaf(o.store, o.key.pk, o.binding, n, digest, "FORS"); // persisted before the signature exists (the salt is deterministic: the same digest gives the same signature)
    const salt = keccak256(concat([o.key.skSeed, digest]));
    return forsSign(o.key, digest, salt);
  };
  return {
    params: forsParams(o.key, first, o.binding.chainId, o.binding.ruleId),
    signDigest,
    sign: (b: IntentBinding) => {
      assertBinding(o.binding, b);
      return signDigest(intentDigest(b), b.ruleEpoch);
    },
  };
}
