import { bytesToHex, concat, hexToBytes, keccak256, recoverAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  arbitraryEntry,
  parseFrameTx,
  serializeFrameTx,
  signatureHash,
  signSecp256k1Entry,
  txHash,
} from "../src/encoder.ts";
import { FrameTxDecodeError, FrameTxEncodeError } from "../src/errors.ts";
import { rlpEncode, type RlpItem } from "../src/rlp.ts";
import { FrameMode, SignatureScheme, type FrameTx } from "../src/types.ts";
import { SPEC_VECTORS } from "./fixtures/spec-vectors.ts";
import { gen, prng } from "./random.ts";

const RANDOM_COUNT = 50;

describe("round trip: random txs", () => {
  const g = gen(prng(0x8141));
  const txs = Array.from({ length: RANDOM_COUNT }, () => g.tx());

  it("covers every frame mode, signatures on/off, recent roots, multiple nonce keys", () => {
    const modes = new Set(txs.flatMap((t) => t.frames.map((f) => f.mode)));
    expect([...modes].sort()).toEqual([0, 1, 2]);
    expect(txs.some((t) => t.signatures.length === 0)).toBe(true);
    expect(txs.some((t) => t.signatures.length > 0)).toBe(true);
    expect(new Set(txs.flatMap((t) => t.signatures.map((s) => s.scheme))).size).toBe(3);
    expect(txs.some((t) => t.recentRootReferences.length > 0)).toBe(true);
    expect(txs.some((t) => t.recentRootReferences.length === 0)).toBe(true);
    expect(txs.some((t) => t.nonceKeys.length > 1)).toBe(true);
    expect(txs.some((t) => t.blobHashes.length > 0)).toBe(true);
  });

  it.each(txs.map((t, i) => [i, t] as const))("tx %i: decode(encode(tx)) deep-equals tx and re-encodes identically", (_i, tx) => {
    const raw = serializeFrameTx(tx);
    expect(raw.startsWith("0x06")).toBe(true);
    const back = parseFrameTx(raw);
    expect(back).toStrictEqual(tx);
    expect(serializeFrameTx(back)).toBe(raw);
    expect(txHash(raw)).toBe(keccak256(raw));
  });
});

describe("recorded vectors (included on devnet1)", () => {
  it.each(SPEC_VECTORS.map((v) => [v.name, v] as const))("%s: byte-for-byte, tx hash, sig hash", (_n, v) => {
    const tx = parseFrameTx(v.raw);
    expect(serializeFrameTx(tx)).toBe(v.raw);
    expect(txHash(v.raw)).toBe(v.txHash);
    expect(txHash(tx)).toBe(v.txHash);
    expect(signatureHash(tx)).toBe(v.sigHash);
    expect(signatureHash(v.raw)).toBe(v.sigHash);
    const mutated: FrameTx = { ...tx, frames: tx.frames.map((f, i) => (i === 0 ? { ...f, data: "0x01" } : f)) };
    expect(tx.frames[0]!.mode).toBe(FrameMode.VERIFY);
    expect(signatureHash(mutated)).toBe(v.sigHashWithFrame0Data0x01);
  });

  it("the rule-pays vector decodes to the rule-pays layout", () => {
    const tx = parseFrameTx(SPEC_VECTORS[0]!.raw);
    expect(tx).toStrictEqual({
      chainId: 1337n,
      nonceKeys: [1003n],
      nonceSeq: 0n,
      sender: "0xb3e29c868351ea79e9e66a028ffca365d47054bf",
      frames: [
        { mode: 1, flags: 3, target: null, gasLimit: 80000n, stateGasLimit: 0n, value: 0n, data: "0x" },
        {
          mode: 2,
          flags: 0,
          target: null,
          gasLimit: 300000n,
          stateGasLimit: 1500000n,
          value: 0n,
          data: "0x0000000000000000000000000000000000000000000000000000000000c0ffee",
        },
      ],
      signatures: [],
      fees: { maxPriorityFeePerGas: 1_000_000_000n, maxFeePerGas: 2_000_000_000n, maxFeePerBlobGas: 0n },
      blobHashes: [],
      recentRootReferences: [],
    });
  });

  it("eoaPayer: the payer signature recovers to the payer over the sig hash", async () => {
    const v = SPEC_VECTORS.find((x) => x.name === "eoaPayer")!;
    const tx = parseFrameTx(v.raw);
    expect(tx.signatures[0]).toStrictEqual(arbitraryEntry());
    const s = tx.signatures[1]!;
    expect(s.scheme).toBe(SignatureScheme.SECP256K1);
    expect(s.msg).toBe("0x");
    const b = hexToBytes(s.signature);
    expect(b.length).toBe(65);
    const sig = concat([bytesToHex(b.subarray(1, 33)), bytesToHex(b.subarray(33, 65)), b[0] === 0 ? "0x1b" : "0x1c"]);
    expect((await recoverAddress({ hash: signatureHash(tx), signature: sig })).toLowerCase()).toBe(s.signer);
  });
});

describe("signature hash coverage", () => {
  const base = parseFrameTx(SPEC_VECTORS[1]!.raw); // EOA payer: 3 frames, ARBITRARY + SECP256K1
  const h0 = signatureHash(base);
  const withFrame = (i: number, patch: Partial<FrameTx["frames"][number]>): FrameTx => ({
    ...base,
    frames: base.frames.map((f, j) => (j === i ? { ...f, ...patch } : f)),
  });

  it.each([0, 1, 2])("changes when frame %i data changes (frames 0 and 1 are VERIFY)", (i) => {
    expect(signatureHash(withFrame(i, { data: "0xdeadbeef" }))).not.toBe(h0);
  });

  const mutations: [string, FrameTx][] = [
    ["chainId", { ...base, chainId: 1338n }],
    ["nonceKeys", { ...base, nonceKeys: [2005n] }],
    ["nonceKeys length", { ...base, nonceKeys: [2004n, 2005n] }],
    ["nonceSeq", { ...base, nonceSeq: 1n }],
    ["sender", { ...base, sender: "0x0000000000000000000000000000000000000001" }],
    ["frame mode", withFrame(2, { mode: FrameMode.DEFAULT })],
    ["frame flags", withFrame(0, { flags: 3 })],
    ["frame target", withFrame(0, { target: "0x0000000000000000000000000000000000000001" })],
    ["frame gasLimit", withFrame(1, { gasLimit: 40_001n })],
    ["frame stateGasLimit", withFrame(2, { stateGasLimit: 1n })],
    ["frame value", withFrame(2, { value: 1n })],
    ["frame added", { ...base, frames: [...base.frames, base.frames[2]!] }],
    ["maxPriorityFeePerGas", { ...base, fees: { ...base.fees, maxPriorityFeePerGas: 1n } }],
    ["maxFeePerGas", { ...base, fees: { ...base.fees, maxFeePerGas: 1n } }],
    ["maxFeePerBlobGas", { ...base, fees: { ...base.fees, maxFeePerBlobGas: 1n } }],
    ["blobHashes", { ...base, blobHashes: [`0x${"11".repeat(32)}`] }],
    ["recentRootReferences", { ...base, recentRootReferences: [{ sourceId: `0x${"22".repeat(32)}`, slot: 5n, root: `0x${"33".repeat(32)}` }] }],
    ["signature signer", { ...base, signatures: [base.signatures[0]!, { ...base.signatures[1]!, signer: null }] }],
    ["signature scheme", { ...base, signatures: [{ ...base.signatures[0]!, scheme: SignatureScheme.P256 }, base.signatures[1]!] }],
    ["signature msg", { ...base, signatures: [base.signatures[0]!, { ...base.signatures[1]!, msg: `0x${"44".repeat(32)}` }] }],
    ["signature entry added", { ...base, signatures: [...base.signatures, arbitraryEntry()] }],
  ];
  it.each(mutations)("changes when %s changes", (_n, t) => {
    expect(signatureHash(t)).not.toBe(h0);
  });

  it("changes when the bytes of a non-empty-msg entry change", () => {
    const m: FrameTx = { ...base, signatures: [{ ...arbitraryEntry("0xaa"), msg: `0x${"55".repeat(32)}` }, base.signatures[1]!] };
    const m2: FrameTx = { ...m, signatures: [{ ...m.signatures[0]!, signature: "0xbb" }, m.signatures[1]!] };
    expect(signatureHash(m2)).not.toBe(signatureHash(m));
  });

  it("is unchanged when only empty-msg signature bytes change", () => {
    const zeroed: FrameTx = { ...base, signatures: base.signatures.map((s) => ({ ...s, signature: "0x" })) };
    const other: FrameTx = {
      ...base,
      signatures: [arbitraryEntry(`0x${"ab".repeat(300)}`), { ...base.signatures[1]!, signature: `0x${"cd".repeat(65)}` }],
    };
    expect(signatureHash(zeroed)).toBe(h0);
    expect(signatureHash(other)).toBe(h0);
    expect(txHash(other)).not.toBe(txHash(base)); // the tx hash does cover them
  });
});

describe("signSecp256k1Entry", () => {
  // Throwaway test key (not a devnet key).
  const account = privateKeyToAccount("0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318");
  const base = parseFrameTx(SPEC_VECTORS[1]!.raw);
  const unsigned: FrameTx = { ...base, signatures: [arbitraryEntry()] };

  it("appends a SECP256K1 entry over the sig hash that recovers to the account", async () => {
    const signed = await signSecp256k1Entry(unsigned, 1, account);
    const s = signed.signatures[1]!;
    expect(s).toMatchObject({ scheme: 1, signer: account.address.toLowerCase(), msg: "0x" });
    const b = hexToBytes(s.signature);
    expect(b.length).toBe(65);
    expect(b[0] === 0 || b[0] === 1).toBe(true);
    const sig = concat([bytesToHex(b.subarray(1, 33)), bytesToHex(b.subarray(33, 65)), b[0] === 0 ? "0x1b" : "0x1c"]);
    expect(await recoverAddress({ hash: signatureHash(signed), signature: sig })).toBe(account.address);
    // signing did not change the hash it signed
    expect(signatureHash(signed)).toBe(signatureHash({ ...signed, signatures: [arbitraryEntry(), { ...s, signature: "0x" }] }));
    expect(parseFrameTx(serializeFrameTx(signed))).toStrictEqual(signed);
  });

  it("is deterministic (RFC 6979) and replaces an existing entry", async () => {
    const a = await signSecp256k1Entry(unsigned, 1, account);
    const b = await signSecp256k1Entry(a, 1, account);
    expect(b).toStrictEqual(a);
  });

  it("rejects an index past the end", async () => {
    await expect(signSecp256k1Entry(unsigned, 3, account)).rejects.toThrow(FrameTxEncodeError);
  });
});

describe("decoder rejects malformed input", () => {
  const raw = SPEC_VECTORS[1]!.raw;
  const body = hexToBytes(raw).subarray(1);
  const prefixed = (item: RlpItem): Hex => bytesToHex(concat([Uint8Array.of(0x06), rlpEncode(item)]));
  // a structurally valid tx as an RLP item we can tamper with
  const items = (): RlpItem[] => {
    const e = (h: Hex) => hexToBytes(h);
    return [
      e("0x0539"),
      [e("0x07d4")],
      new Uint8Array(),
      e("0xec3bd98961e0931090950bf84ff64fabe60ad948"),
      [[e("0x01"), e("0x02"), new Uint8Array(), [e("0x7530"), new Uint8Array()], new Uint8Array(), new Uint8Array()]],
      [],
      [e("0x3b9aca00"), e("0x77359400"), new Uint8Array()],
      [],
      [],
    ];
  };

  it("accepts the untampered baseline", () => {
    expect(() => parseFrameTx(prefixed(items()))).not.toThrow();
  });

  const cases: [string, Hex | Uint8Array][] = [
    ["empty input", "0x"],
    ["odd-length hex", "0x060"],
    ["type byte 0x02", `0x02${raw.slice(4)}`],
    ["type byte 0x05", `0x05${raw.slice(4)}`],
    ["no type byte (bare RLP)", bytesToHex(body)],
    ["truncated by 1 byte", raw.slice(0, -2) as Hex],
    ["truncated to half", raw.slice(0, raw.length / 2 + (raw.length / 2) % 2) as Hex],
    ["only the type byte", "0x06"],
    ["trailing byte", `${raw}00`],
    ["8 top-level fields", prefixed(items().slice(0, 8))],
    ["10 top-level fields", prefixed([...items(), new Uint8Array()])],
    ["top level is a string", prefixed(hexToBytes("0x1234"))],
    ["frame with 5 fields", prefixed(items().map((x, i) => (i === 4 ? [(x as RlpItem[])[0]!.slice(0, 5) as RlpItem] : x)))],
    ["frame with 7 fields", prefixed(items().map((x, i) => (i === 4 ? [[...((x as RlpItem[])[0] as RlpItem[]), new Uint8Array()]] : x)))],
    ["limits with 1 field", prefixed(items().map((x, i) => (i === 4 ? [[hexToBytes("0x01"), hexToBytes("0x02"), new Uint8Array(), [hexToBytes("0x7530")], new Uint8Array(), new Uint8Array()]] : x)))],
    ["fees with 2 fields", prefixed(items().map((x, i) => (i === 6 ? (x as RlpItem[]).slice(0, 2) : x)))],
    ["signature with 3 fields", prefixed(items().map((x, i) => (i === 5 ? [[new Uint8Array(), new Uint8Array(), new Uint8Array()]] : x)))],
    ["chainId with leading zero", prefixed(items().map((x, i) => (i === 0 ? hexToBytes("0x000539") : x)))],
    ["nonceSeq encoded as 0x00", prefixed(items().map((x, i) => (i === 2 ? hexToBytes("0x00") : x)))],
    ["nonce key with leading zero", prefixed(items().map((x, i) => (i === 1 ? [hexToBytes("0x0007d4")] : x)))],
    ["chainId wider than u64", prefixed(items().map((x, i) => (i === 0 ? hexToBytes("0x010000000000000000") : x)))],
    ["maxFeePerGas wider than u64", prefixed(items().map((x, i) => (i === 6 ? [hexToBytes("0x01"), hexToBytes("0x010000000000000000"), new Uint8Array()] : x)))],
    ["sender 19 bytes", prefixed(items().map((x, i) => (i === 3 ? hexToBytes("0xec3bd98961e0931090950bf84ff64fabe60ad9") : x)))],
    ["nonceKeys is a string", prefixed(items().map((x, i) => (i === 1 ? hexToBytes("0x07d4") : x)))],
    ["frames is a string", prefixed(items().map((x, i) => (i === 4 ? hexToBytes("0x01") : x)))],
    ["frame mode 5 (UTXO, unsupported)", prefixed(items().map((x, i) => (i === 4 ? [[hexToBytes("0x05"), hexToBytes("0x02"), new Uint8Array(), [hexToBytes("0x7530"), new Uint8Array()], new Uint8Array(), new Uint8Array()]] : x)))],
    ["signature scheme 3", prefixed(items().map((x, i) => (i === 5 ? [[hexToBytes("0x03"), new Uint8Array(), new Uint8Array(), new Uint8Array()]] : x)))],
    ["blob hash 31 bytes", prefixed(items().map((x, i) => (i === 7 ? [new Uint8Array(31)] : x)))],
    // non-canonical RLP framing
    ["single byte wrapped (0x81 0x05)", bytesToHex(concat([Uint8Array.of(0x06), patchFirstField(hexToBytes(prefixed(items())).subarray(1))]))],
    ["long-form list length for a short list", bytesToHex(Uint8Array.of(0x06, 0xf8, 0x03, 0x80, 0x80, 0x80))],
    ["length prefix with leading zero", bytesToHex(Uint8Array.of(0x06, 0xf9, 0x00, 0x38, ...new Uint8Array(56)))],
  ];

  it.each(cases)("rejects: %s", (_n, input) => {
    expect(() => parseFrameTx(input)).toThrow(FrameTxDecodeError);
  });
});

/** Re-encodes the first top-level field (chainId 0x0539) as a non-canonical wrapped single byte 0x05. */
function patchFirstField(rlp: Uint8Array): Uint8Array {
  // list header, then 0x82 05 39 -> replace with 0x81 05 (one byte shorter, adjust header)
  const hdrLen = rlp[0]! <= 0xf7 ? 1 : 1 + (rlp[0]! - 0xf7);
  const payload = rlp.subarray(hdrLen);
  if (payload[0] !== 0x82 || payload[1] !== 0x05 || payload[2] !== 0x39) throw new Error("unexpected fixture");
  const newPayload = concatBytes(Uint8Array.of(0x81, 0x05), payload.subarray(3));
  return rlpListHeader(newPayload);
}
function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const o = new Uint8Array(a.length + b.length);
  o.set(a);
  o.set(b, a.length);
  return o;
}
function rlpListHeader(payload: Uint8Array): Uint8Array {
  if (payload.length > 55) throw new Error("fixture too long");
  return concatBytes(Uint8Array.of(0xc0 + payload.length), payload);
}

describe("encoder rejects unencodable values", () => {
  const tx = parseFrameTx(SPEC_VECTORS[0]!.raw);
  const cases: [string, FrameTx][] = [
    ["negative nonceSeq", { ...tx, nonceSeq: -1n }],
    ["chainId over u64", { ...tx, chainId: 1n << 64n }],
    ["gasLimit over u64", { ...tx, frames: [{ ...tx.frames[0]!, gasLimit: 1n << 64n }] }],
    ["nonce key over u256", { ...tx, nonceKeys: [1n << 256n] }],
    ["flags over u8", { ...tx, frames: [{ ...tx.frames[0]!, flags: 256 }] }],
    ["short sender", { ...tx, sender: "0x1234" }],
    ["odd-length data", { ...tx, frames: [{ ...tx.frames[0]!, data: "0x123" }] }],
    ["non-hex data", { ...tx, frames: [{ ...tx.frames[0]!, data: "0xzz" as Hex }] }],
    ["31-byte blob hash", { ...tx, blobHashes: [`0x${"00".repeat(31)}`] }],
  ];
  it.each(cases)("rejects: %s", (_n, t) => {
    expect(() => serializeFrameTx(t)).toThrow(FrameTxEncodeError);
  });
});
