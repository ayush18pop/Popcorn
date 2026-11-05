// WOTS+ (w = 16, n = 32, keccak256) with a height-10 Merkle tree of one-time keys: the signer side of Popcorn Core's
// owner path (contracts/core/LAYOUT.md "OWNER"). Copied from pq-sig/signer/wots.ts (the scheme measured on the devnet: 70,405 VERIFY
// gas for the verifier alone) and fixed to Core's parameters; the Yul verifier is in
// contracts/core/PopcornCore.yul (wotsVerify). Both must agree bit for bit.
//
//   chain step   F(T, x) = keccak256(T ++ x),  T = pubSeed XOR (leaf << 16 | chain << 8 | step)
//   leaf hash    keccak256(pk_0 ++ ... ++ pk_66)        node = keccak256(left ++ right)
//   signed msg   the frame tx's signature hash (TXPARAM 0x08)
//   entry bytes  leaf (32, big-endian) ++ 67 chain values ++ 10 path nodes = 2,496 bytes (an ARBITRARY signature entry)
//
// SECRET MATERIAL: `skSeed` regenerates every one-time key. Whoever has it can sign as the owner's WOTS half. Store it
// like a private key (under keys/, never committed). `pubSeed` and `root` are public.
import { keccak256, type Hex } from "viem";

export const WOTS_W = 16;
export const WOTS_LOG_W = 4;
export const WOTS_LEN1 = 64;
export const WOTS_LEN2 = 3;
export const WOTS_LEN = 67;
export const WOTS_HEIGHT = 10;
export const WOTS_LEAVES = 1 << WOTS_HEIGHT;
/** 67 chain values + 10 path nodes. */
export const WOTS_SIG_BYTES = 32 * (WOTS_LEN + WOTS_HEIGHT);
/** The ARBITRARY entry Core reads: leaf (32) ++ signature. */
export const WOTS_ENTRY_BYTES = 32 + WOTS_SIG_BYTES;

const hexToBytes = (h: string): Uint8Array => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
};
const bytesToHex = (b: Uint8Array): Hex => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const k256 = (b: Uint8Array): Uint8Array => keccak256(b, "bytes");

function u256(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

const buf64 = new Uint8Array(64);
function chain(x: Uint8Array, pubSeed: Uint8Array, leaf: number, i: number, start: number, end: number): Uint8Array {
  let cur = x;
  for (let s = start; s < end; s++) {
    buf64.set(pubSeed, 0);
    const t = (leaf << 16) | (i << 8) | s;
    buf64[28]! ^= (t >>> 24) & 0xff;
    buf64[29]! ^= (t >>> 16) & 0xff;
    buf64[30]! ^= (t >>> 8) & 0xff;
    buf64[31]! ^= t & 0xff;
    buf64.set(cur, 32);
    cur = k256(buf64);
  }
  return cur;
}

/** Base-16 digits of the message (64) then the checksum (3), exactly as Core's wotsVerify computes them. */
export function wotsDigits(msg: Hex): number[] {
  const m = BigInt(msg);
  const d: number[] = [];
  let csum = 0;
  for (let i = 0; i < WOTS_LEN1; i++) {
    const v = Number((m >> BigInt(256 - WOTS_LOG_W * (i + 1))) & 15n);
    d.push(v);
    csum += 15 - v;
  }
  for (let j = 0; j < WOTS_LEN2; j++) d.push((csum >> (WOTS_LOG_W * (WOTS_LEN2 - 1 - j))) & 15);
  return d;
}

/** Hash steps Core's verifier runs for this message (~111 gas each). Mean ~506, max 660 over 20,000 random messages. */
export function wotsSteps(msg: Hex): number {
  return wotsDigits(msg).reduce((a, d) => a + (15 - d), 0);
}

function skFor(skSeed: Uint8Array, leaf: number, i: number): Uint8Array {
  const b = new Uint8Array(96);
  b.set(skSeed, 0);
  b.set(u256(BigInt(leaf)), 32);
  b.set(u256(BigInt(i)), 64);
  return k256(b);
}

function leafHash(skSeed: Uint8Array, pubSeed: Uint8Array, leaf: number): Uint8Array {
  const pk = new Uint8Array(32 * WOTS_LEN);
  for (let i = 0; i < WOTS_LEN; i++) pk.set(chain(skFor(skSeed, leaf, i), pubSeed, leaf, i, 0, 15), 32 * i);
  return k256(pk);
}

/** The whole tree of one-time keys, regenerated deterministically from the two seeds (about 4 s). */
export interface WotsTree {
  skSeed: Hex;
  pubSeed: Hex;
  /** Merkle root: Core's owner.wotsRoot. */
  root: Hex;
  levels: Uint8Array[][];
}

export function wotsKeygen(skSeed: Hex, pubSeed: Hex): WotsTree {
  const sk = hexToBytes(skSeed);
  const ps = hexToBytes(pubSeed);
  if (sk.length !== 32 || ps.length !== 32) throw new Error("wotsKeygen: skSeed and pubSeed must be 32 bytes");
  const levels: Uint8Array[][] = [[]];
  for (let i = 0; i < WOTS_LEAVES; i++) levels[0]!.push(leafHash(sk, ps, i));
  for (let l = 0; l < WOTS_HEIGHT; l++) {
    const prev = levels[l]!;
    const next: Uint8Array[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const b = new Uint8Array(64);
      b.set(prev[i]!, 0);
      b.set(prev[i + 1]!, 32);
      next.push(k256(b));
    }
    levels.push(next);
  }
  return { skSeed, pubSeed, root: bytesToHex(levels[WOTS_HEIGHT]![0]!), levels };
}

/** The ARBITRARY signature entry bytes for `msg` at `leaf`: leaf (32) ++ 67 chain values ++ 10 path nodes. */
export function wotsSign(tree: WotsTree, msg: Hex, leaf: number): Hex {
  if (!Number.isInteger(leaf) || leaf < 0 || leaf >= WOTS_LEAVES) throw new Error(`wotsSign: leaf ${leaf} out of range`);
  const sk = hexToBytes(tree.skSeed);
  const ps = hexToBytes(tree.pubSeed);
  const d = wotsDigits(msg);
  const out = new Uint8Array(WOTS_ENTRY_BYTES);
  out.set(u256(BigInt(leaf)), 0);
  for (let i = 0; i < WOTS_LEN; i++) out.set(chain(skFor(sk, leaf, i), ps, leaf, i, 0, d[i]!), 32 + 32 * i);
  for (let l = 0; l < WOTS_HEIGHT; l++) out.set(tree.levels[l]![(leaf >> l) ^ 1]!, 32 + 32 * (WOTS_LEN + l));
  return bytesToHex(out);
}

/** Reference verifier (mirrors Core's wotsVerify). */
export function wotsVerify(root: Hex, pubSeed: Hex, msg: Hex, entry: Hex): boolean {
  const e = hexToBytes(entry);
  if (e.length !== WOTS_ENTRY_BYTES) return false;
  let leafBig = 0n;
  for (let i = 0; i < 32; i++) leafBig = (leafBig << 8n) | BigInt(e[i]!);
  if (leafBig >= BigInt(WOTS_LEAVES)) return false;
  const leaf = Number(leafBig);
  const ps = hexToBytes(pubSeed);
  const d = wotsDigits(msg);
  const pk = new Uint8Array(32 * WOTS_LEN);
  for (let i = 0; i < WOTS_LEN; i++) pk.set(chain(e.slice(32 + 32 * i, 64 + 32 * i), ps, leaf, i, d[i]!, 15), 32 * i);
  let node = k256(pk);
  for (let l = 0; l < WOTS_HEIGHT; l++) {
    const off = 32 + 32 * (WOTS_LEN + l);
    const sib = e.slice(off, off + 32);
    const b = new Uint8Array(64);
    if (((leaf >> l) & 1) === 0) {
      b.set(node, 0);
      b.set(sib, 32);
    } else {
      b.set(sib, 0);
      b.set(node, 32);
    }
    node = k256(b);
  }
  return bytesToHex(node) === root.toLowerCase();
}
