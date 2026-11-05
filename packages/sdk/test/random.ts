// Seeded random FrameTx generator for round-trip tests.
import type { Address, Hex } from "viem";
import { FrameMode, SignatureScheme, type Frame, type FrameTx, type SignatureEntry } from "../src/types.ts";

/** mulberry32 */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gen(rand: () => number) {
  const int = (n: number) => Math.floor(rand() * n);
  const hex = (len: number): Hex => {
    let s = "0x";
    for (let i = 0; i < len; i++) s += int(256).toString(16).padStart(2, "0");
    return s as Hex;
  };
  /** Mix of 0, small, and full-width values so every RLP length class is hit. */
  const uint = (bits: number): bigint => {
    const r = int(4);
    if (r === 0) return 0n;
    if (r === 1) return BigInt(int(128));
    const bytes = 1 + int(bits / 8);
    const v = BigInt(hex(bytes));
    return v % (1n << BigInt(bits));
  };
  const addr = (): Address => hex(20);
  const data = (): Hex => {
    const r = int(5);
    if (r === 0) return "0x";
    if (r === 1) return hex(1);
    if (r === 2) return hex(32);
    return hex(int(300)); // crosses the 55-byte short/long boundary
  };
  const frame = (mode: FrameMode): Frame => ({
    mode,
    flags: int(8),
    target: rand() < 0.5 ? null : addr(),
    gasLimit: uint(64),
    stateGasLimit: uint(64),
    value: mode === FrameMode.SENDER ? uint(256) : 0n,
    data: data(),
  });
  const sig = (): SignatureEntry => {
    const scheme = [SignatureScheme.ARBITRARY, SignatureScheme.SECP256K1, SignatureScheme.P256][int(3)]!;
    return {
      scheme,
      signer: scheme === SignatureScheme.ARBITRARY || rand() < 0.3 ? null : addr(),
      msg: rand() < 0.6 ? "0x" : hex(32),
      signature: scheme === SignatureScheme.SECP256K1 ? hex(65) : scheme === SignatureScheme.P256 ? hex(128) : data(),
    };
  };
  const tx = (): FrameTx => {
    const nKeys = 1 + int(4);
    let k = rand() < 0.2 ? 0n : uint(256) % (1n << 200n);
    const nonceKeys: bigint[] = [];
    for (let i = 0; i < nKeys; i++) {
      nonceKeys.push(k);
      k += 1n + BigInt(int(1000));
    }
    const modes: FrameMode[] = [FrameMode.VERIFY, FrameMode.DEFAULT, FrameMode.SENDER];
    const frames: Frame[] = [];
    const nFrames = 1 + int(5);
    for (let i = 0; i < nFrames; i++) frames.push(frame(modes[int(3)]!));
    return {
      chainId: rand() < 0.5 ? 1337n : uint(64),
      nonceKeys,
      nonceSeq: uint(64) % ((1n << 64n) - 1n),
      sender: addr(),
      frames,
      signatures: Array.from({ length: int(4) }, sig),
      fees: { maxPriorityFeePerGas: uint(64), maxFeePerGas: uint(64), maxFeePerBlobGas: uint(256) },
      blobHashes: Array.from({ length: int(3) }, () => hex(32)),
      recentRootReferences: Array.from({ length: int(4) }, () => ({ sourceId: hex(32), slot: uint(64), root: hex(32) })),
    };
  };
  return { tx, frame, sig, hex, addr };
}
