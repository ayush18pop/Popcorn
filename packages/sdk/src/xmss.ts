// XMSS / LMS-style stateful signature, keccak256 (contracts/src/signers/lib/XmssLib.sol). OUR OWN construction: not RFC 8391, not NIST SP 800-208,
// no KATs from either (self-generated vectors only). WOTS+ (w = 16, 67 chains) per leaf, Merkle tree of height H (1..20), a tweak on every hash.
//   chain step  T = I XOR (q << 16 | chain << 8 | step)      x' = keccak256(T ++ x)
//   leaf        T = I XOR (1 << 200 | q)                      keccak256(T ++ y_0 ++ ... ++ y_66)
//   node        T = I XOR (2 << 200 | level << 32 | index)    keccak256(T ++ left ++ right)
//   message     m = keccak256((I XOR (3 << 200 | q)) ++ salt ++ digest) -> 64 base-16 digits + 3 checksum digits
//   signature   salt (32) ++ 67 chain values ++ H auth nodes
// Stateful: leaf q signs ONE digest. The predicate fixes q = ruleEpoch - firstEpoch; the signer refuses to sign a second digest with a leaf.
import { concat, hexToBytes, keccak256, toHex, type Hex } from "viem";
import { IntentError, StepBudgetExceeded, assertBinding, claimLeaf, grindSalt, intentDigest, type IntentBinding, type IntentKeyBinding, type StepBudget, type UsageStore } from "./intent.ts";
import { wotsDigits } from "./wots.ts";

export const XMSS_LEN = 67;
export const XMSS_MAX_HEIGHT = 20;
export const xmssSigBytes = (height: number): number => 32 + 32 * (XMSS_LEN + height);

const k = (b: Uint8Array): Uint8Array => hexToBytes(keccak256(b));
const u256 = (n: bigint): Uint8Array => hexToBytes(toHex(n, { size: 32 }));
const cat = (...p: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(p.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of p) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};
const chainStep = (I: bigint, q: number, i: number, s: number, x: Uint8Array): Uint8Array => k(cat(u256(I ^ ((BigInt(q) << 16n) | (BigInt(i) << 8n) | BigInt(s))), x));
const chain = (I: bigint, q: number, i: number, x: Uint8Array, from: number, to: number): Uint8Array => {
  let cur = x;
  for (let s = from; s < to; s++) cur = chainStep(I, q, i, s, cur);
  return cur;
};
const skFor = (skSeed: Uint8Array, q: number, i: number): Uint8Array => k(cat(skSeed, u256(BigInt(q)), u256(BigInt(i))));
const leafTweak = (I: bigint, q: number): Uint8Array => u256(I ^ ((1n << 200n) | BigInt(q)));
const nodeTweak = (I: bigint, level: number, index: number): Uint8Array => u256(I ^ ((2n << 200n) | (BigInt(level) << 32n) | BigInt(index)));
const msgOf = (I: bigint, q: number, salt: Hex, digest: Hex): Hex => keccak256(concat([toHex(u256(I ^ ((3n << 200n) | BigInt(q)))), salt, digest]));

export interface XmssTree {
  skSeed: Hex;
  I: Hex;
  height: number;
  root: Hex;
  levels: Uint8Array[][];
}

function leafOf(skSeed: Uint8Array, I: bigint, q: number): Uint8Array {
  const ends: Uint8Array[] = [];
  for (let i = 0; i < XMSS_LEN; i++) ends.push(chain(I, q, i, skFor(skSeed, q, i), 0, 15));
  return k(cat(leafTweak(I, q), ...ends));
}

/** Builds the whole tree: 2^height leaves x ~1,000 hashes (height 10: about 4 s). */
export function xmssKeygen(skSeed: Hex, I: Hex, height: number): XmssTree {
  if (!Number.isInteger(height) || height < 1 || height > XMSS_MAX_HEIGHT) throw new IntentError(`xmss height must be 1..${XMSS_MAX_HEIGHT}`);
  const sk = hexToBytes(skSeed);
  const seed = BigInt(I);
  const levels: Uint8Array[][] = [[]];
  for (let q = 0; q < 1 << height; q++) levels[0]!.push(leafOf(sk, seed, q));
  for (let l = 1; l <= height; l++) {
    const prev = levels[l - 1]!;
    const row: Uint8Array[] = [];
    for (let j = 0; j < prev.length / 2; j++) row.push(k(cat(nodeTweak(seed, l, j), prev[2 * j]!, prev[2 * j + 1]!)));
    levels.push(row);
  }
  return { skSeed, I, height, root: toHex(levels[height]![0]!), levels };
}

export function xmssSign(tree: XmssTree, digest: Hex, q: number, salt: Hex): Hex {
  if (!Number.isInteger(q) || q < 0 || q >= 1 << tree.height) throw new IntentError(`xmss leaf ${q} out of range`);
  const seed = BigInt(tree.I);
  const sk = hexToBytes(tree.skSeed);
  const d = wotsDigits(msgOf(seed, q, salt, digest));
  const parts: Uint8Array[] = [hexToBytes(salt)];
  for (let i = 0; i < XMSS_LEN; i++) parts.push(chain(seed, q, i, skFor(sk, q, i), 0, d[i]!));
  for (let l = 0; l < tree.height; l++) parts.push(tree.levels[l]![(q >> l) ^ 1]!);
  return toHex(cat(...parts));
}

export function xmssVerify(root: Hex, I: Hex, height: number, q: number, digest: Hex, sig: Hex): boolean {
  const e = hexToBytes(sig);
  if (height < 1 || height > XMSS_MAX_HEIGHT || q < 0 || q >= 1 << height || e.length !== xmssSigBytes(height)) return false;
  const seed = BigInt(I);
  const d = wotsDigits(msgOf(seed, q, toHex(e.slice(0, 32)), digest));
  const ends: Uint8Array[] = [];
  for (let i = 0; i < XMSS_LEN; i++) ends.push(chain(seed, q, i, e.slice(32 + 32 * i, 64 + 32 * i), d[i]!, 15));
  let node = k(cat(leafTweak(seed, q), ...ends));
  for (let l = 0; l < height; l++) {
    const off = 32 + 32 * (XMSS_LEN + l);
    const sib = e.slice(off, off + 32);
    const [left, right] = ((q >> l) & 1) === 0 ? [node, sib] : [sib, node];
    node = k(cat(nodeTweak(seed, l + 1, q >> (l + 1)), left, right));
  }
  return toHex(node) === root.toLowerCase();
}

export interface XmssKey {
  root: Hex;
  I: Hex;
  height: number;
  firstEpoch: bigint | number;
  chainId: bigint | number;
  ruleId: bigint | number;
}
/** Params for XmssSigner: root ++ I ++ firstEpoch ++ height ++ chainId ++ ruleId. */
export const xmssParams = (k_: XmssKey): Hex =>
  concat([k_.root, k_.I, toHex(BigInt(k_.firstEpoch), { size: 32 }), toHex(k_.height, { size: 32 }), toHex(BigInt(k_.chainId), { size: 32 }), toHex(BigInt(k_.ruleId), { size: 32 })]);

/** The on-chain key (and params) of a tree for a chain and rule: needs no rule contract address. */
export const xmssIntentKey = (tree: XmssTree, firstEpoch: bigint | number, chainId: bigint | number, ruleId: bigint | number): XmssKey => ({ root: tree.root, I: tree.I, height: tree.height, firstEpoch: BigInt(firstEpoch), chainId, ruleId });

export interface XmssIntentSignerOptions {
  tree: XmssTree;
  firstEpoch: bigint | number;
  /** The one (chainId, rule contract, ruleId) this tree serves. */
  binding: IntentKeyBinding;
  store: UsageStore;
  /** REQUIRED salt-grinding budget (see StepBudget): nothing is signed or persisted if no salt fits. */
  budget: StepBudget;
}
export function xmssIntentSigner(o: XmssIntentSignerOptions) {
  if (!o.store) throw new IntentError("xmssIntentSigner: pass a `store` (fileUsageStore)");
  if (!o.budget || !(o.budget.maxSteps > 0)) throw new IntentError("xmssIntentSigner: pass `budget: { maxSteps }`");
  const first = BigInt(o.firstEpoch);
  const key: XmssKey = { root: o.tree.root, I: o.tree.I, height: o.tree.height, firstEpoch: first, chainId: o.binding.chainId, ruleId: o.binding.ruleId };
  const seed = BigInt(o.tree.I);
  const signDigest = (digest: Hex, ruleEpoch: bigint | number): Hex => {
    const e = BigInt(ruleEpoch);
    if (e < first) throw new IntentError(`ruleEpoch ${e} is below firstEpoch ${first}`);
    const q = Number(e - first);
    if (q >= 1 << o.tree.height) throw new IntentError(`XMSS tree exhausted: leaf ${q} >= ${1 << o.tree.height}`);
    const best = claimLeaf(o.store, o.tree.root, o.binding, q, digest, "XMSS", () => {
      const g = grindSalt((i) => keccak256(concat([o.tree.skSeed, digest, toHex(i, { size: 4 })])), (sl) => msgOf(seed, q, sl, digest), { maxTries: o.budget.maxTries ?? 200_000, targetSteps: o.budget.maxSteps });
      if (g.steps > o.budget.maxSteps) throw new StepBudgetExceeded(g.steps, o.budget.maxSteps, g.tries);
      return g.salt;
    }) as Hex;
    return xmssSign(o.tree, digest, q, best);
  };
  return {
    key,
    params: xmssParams(key),
    signDigest,
    sign: (b: IntentBinding) => {
      assertBinding(o.binding, b);
      return signDigest(intentDigest(b), b.ruleEpoch);
    },
  };
}
