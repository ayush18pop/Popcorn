// Frame transaction (type 0x06) encoder, strict decoder, tx hash and signature hash.
// Wire format: contracts/core/SPEC.md §6. Test vectors: test/fixtures/spec-vectors.ts.
import { bytesToHex, hexToBytes, isHex, keccak256, parseSignature, type Address, type Hex, type LocalAccount } from "viem";
import { FrameTxDecodeError, FrameTxEncodeError } from "./errors.ts";
import { rlpDecode, rlpEncode, type RlpItem } from "./rlp.ts";
import {
  FRAME_TX_TYPE,
  FrameMode,
  SignatureScheme,
  type Frame,
  type FrameTx,
  type FrameTxFees,
  type RecentRootReference,
  type SignatureEntry,
} from "./types.ts";

const MODES = new Set<number>(Object.values(FrameMode));
const SCHEMES = new Set<number>(Object.values(SignatureScheme));

export interface SerializeOptions {
  /**
   * Skip the mode/scheme membership checks (0..2) that parseFrameTx enforces, so tests can
   * build txs with reserved modes or unknown schemes on purpose. Width/length checks stay
   * (the bytes must still be encodable). Default false.
   */
  unsafe?: boolean;
}

// ---------------------------------------------------------------- encode helpers

function encErr(field: string, msg: string): never {
  throw new FrameTxEncodeError(`${field}: ${msg}`);
}

function uint(field: string, n: bigint, bits: number): Uint8Array {
  if (typeof n !== "bigint") encErr(field, `expected bigint, got ${typeof n}`);
  if (n < 0n || n >= 1n << BigInt(bits)) encErr(field, `${n} does not fit in uint${bits}`);
  if (n === 0n) return new Uint8Array();
  let h = n.toString(16);
  if (h.length % 2) h = "0" + h;
  return hexToBytes(`0x${h}`);
}

function small(field: string, n: number): Uint8Array {
  if (!Number.isInteger(n)) encErr(field, `expected an integer, got ${n}`);
  return uint(field, BigInt(n), 8);
}

function bytes(field: string, h: Hex, len?: number): Uint8Array {
  if (typeof h !== "string" || !isHex(h, { strict: true }) || h.length % 2) encErr(field, `not even-length hex: ${String(h)}`);
  const b = hexToBytes(h);
  if (len !== undefined && b.length !== len) encErr(field, `expected ${len} bytes, got ${b.length}`);
  return b;
}

function optAddress(field: string, a: Address | null): Uint8Array {
  return a === null ? new Uint8Array() : bytes(field, a, 20);
}

function frameItem(f: Frame, i: number, unsafe: boolean): RlpItem {
  const p = `frames[${i}]`;
  if (!unsafe && !MODES.has(f.mode)) encErr(`${p}.mode`, `unsupported frame mode ${f.mode} (pass { unsafe: true } to encode it anyway)`);
  return [
    small(`${p}.mode`, f.mode),
    small(`${p}.flags`, f.flags),
    optAddress(`${p}.target`, f.target),
    [uint(`${p}.gasLimit`, f.gasLimit, 64), uint(`${p}.stateGasLimit`, f.stateGasLimit, 64)],
    uint(`${p}.value`, f.value, 256),
    bytes(`${p}.data`, f.data),
  ];
}

function signatureItem(s: SignatureEntry, i: number, unsafe: boolean): RlpItem {
  const p = `signatures[${i}]`;
  if (!unsafe && !SCHEMES.has(s.scheme)) encErr(`${p}.scheme`, `unknown signature scheme ${s.scheme} (pass { unsafe: true } to encode it anyway)`);
  return [small(`${p}.scheme`, s.scheme), optAddress(`${p}.signer`, s.signer), bytes(`${p}.msg`, s.msg), bytes(`${p}.signature`, s.signature)];
}

function feesItem(f: FrameTxFees): RlpItem {
  return [
    uint("fees.maxPriorityFeePerGas", f.maxPriorityFeePerGas, 64),
    uint("fees.maxFeePerGas", f.maxFeePerGas, 64),
    uint("fees.maxFeePerBlobGas", f.maxFeePerBlobGas, 256),
  ];
}

function rootItem(r: RecentRootReference, i: number): RlpItem {
  const p = `recentRootReferences[${i}]`;
  return [bytes(`${p}.sourceId`, r.sourceId, 32), uint(`${p}.slot`, r.slot, 64), bytes(`${p}.root`, r.root, 32)];
}

function txItem(tx: FrameTx, unsafe: boolean): RlpItem {
  return [
    uint("chainId", tx.chainId, 64),
    tx.nonceKeys.map((k, i) => uint(`nonceKeys[${i}]`, k, 256)),
    uint("nonceSeq", tx.nonceSeq, 64),
    bytes("sender", tx.sender, 20),
    tx.frames.map((f, i) => frameItem(f, i, unsafe)),
    tx.signatures.map((x, i) => signatureItem(x, i, unsafe)),
    feesItem(tx.fees),
    tx.blobHashes.map((h, i) => bytes(`blobHashes[${i}]`, h, 32)),
    tx.recentRootReferences.map(rootItem),
  ];
}

function serializeBytes(tx: FrameTx, unsafe = false): Uint8Array {
  const body = rlpEncode(txItem(tx, unsafe));
  const out = new Uint8Array(body.length + 1);
  out[0] = FRAME_TX_TYPE;
  out.set(body, 1);
  return out;
}

/**
 * Encodes a frame transaction as `0x06 || rlp(fields)` (SPEC §6). Checks wire-level
 * constraints (integer widths, byte lengths, hex) and, like parseFrameTx, that modes and
 * schemes are known (skip with `{ unsafe: true }`). Protocol rules such as nonce-key
 * ordering are checked separately by {@link validateFrameTx}, so invalid txs can still be
 * built on purpose.
 */
export function serializeFrameTx(tx: FrameTx, opts: SerializeOptions = {}): Hex {
  return bytesToHex(serializeBytes(tx, opts.unsafe === true));
}

// ---------------------------------------------------------------- decode helpers

function decErr(field: string, msg: string): never {
  throw new FrameTxDecodeError(`${field}: ${msg}`);
}

function asBytes(field: string, x: RlpItem | undefined): Uint8Array {
  if (!(x instanceof Uint8Array)) decErr(field, "expected a byte string, got a list");
  return x;
}

function asList(field: string, x: RlpItem | undefined, count?: number): RlpItem[] {
  if (!Array.isArray(x)) decErr(field, "expected a list, got a byte string");
  if (count !== undefined && x.length !== count) decErr(field, `expected ${count} fields, got ${x.length}`);
  return x;
}

function dUint(field: string, x: RlpItem | undefined, bits: number): bigint {
  const b = asBytes(field, x);
  if (b.length === 0) return 0n;
  if (b[0] === 0) decErr(field, "non-canonical integer (leading zero byte)");
  if (b.length * 8 > bits) decErr(field, `integer wider than uint${bits}`);
  return BigInt(bytesToHex(b));
}

function dBytes(field: string, x: RlpItem | undefined, len?: number): Hex {
  const b = asBytes(field, x);
  if (len !== undefined && b.length !== len) decErr(field, `expected ${len} bytes, got ${b.length}`);
  return bytesToHex(b);
}

function dOptAddress(field: string, x: RlpItem | undefined): Address | null {
  const b = asBytes(field, x);
  if (b.length === 0) return null;
  if (b.length !== 20) decErr(field, `expected 0 or 20 bytes, got ${b.length}`);
  return bytesToHex(b);
}

function dFrame(x: RlpItem, i: number): Frame {
  const p = `frames[${i}]`;
  const [mode, flags, target, limits, value, data] = asList(p, x, 6);
  const [exec, state] = asList(`${p}.limits`, limits, 2);
  const m = Number(dUint(`${p}.mode`, mode, 8));
  if (!MODES.has(m)) decErr(`${p}.mode`, `unsupported frame mode ${m}`);
  return {
    mode: m as FrameMode,
    flags: Number(dUint(`${p}.flags`, flags, 8)),
    target: dOptAddress(`${p}.target`, target),
    gasLimit: dUint(`${p}.gasLimit`, exec, 64),
    stateGasLimit: dUint(`${p}.stateGasLimit`, state, 64),
    value: dUint(`${p}.value`, value, 256),
    data: dBytes(`${p}.data`, data),
  };
}

function dSignature(x: RlpItem, i: number): SignatureEntry {
  const p = `signatures[${i}]`;
  const [scheme, signer, msg, signature] = asList(p, x, 4);
  const s = Number(dUint(`${p}.scheme`, scheme, 8));
  if (!SCHEMES.has(s)) decErr(`${p}.scheme`, `unknown signature scheme ${s}`);
  return {
    scheme: s as SignatureScheme,
    signer: dOptAddress(`${p}.signer`, signer),
    msg: dBytes(`${p}.msg`, msg),
    signature: dBytes(`${p}.signature`, signature),
  };
}

function dRoot(x: RlpItem, i: number): RecentRootReference {
  const p = `recentRootReferences[${i}]`;
  const [sourceId, slot, root] = asList(p, x, 3);
  return { sourceId: dBytes(`${p}.sourceId`, sourceId, 32), slot: dUint(`${p}.slot`, slot, 64), root: dBytes(`${p}.root`, root, 32) };
}

/**
 * Strict inverse of {@link serializeFrameTx}. Rejects a wrong type byte, malformed or
 * non-canonical RLP, wrong field counts, over-wide or non-canonical integers, wrong byte
 * lengths, and unknown modes/schemes. Hex in the result is lowercase.
 */
export function parseFrameTx(raw: Hex | Uint8Array): FrameTx {
  let buf: Uint8Array;
  if (typeof raw === "string") {
    if (!isHex(raw, { strict: true }) || raw.length % 2) decErr("raw", "not even-length hex");
    buf = hexToBytes(raw);
  } else buf = raw;
  if (buf.length === 0) decErr("raw", "empty input");
  if (buf[0] !== FRAME_TX_TYPE) decErr("type", `expected 0x06, got 0x${buf[0]!.toString(16).padStart(2, "0")}`);
  const top = asList("tx", rlpDecode(buf.subarray(1)), 9);
  const [chainId, nonceKeys, nonceSeq, sender, frames, signatures, fees, blobHashes, roots] = top;
  const [prio, maxFee, blobFee] = asList("fees", fees, 3);
  return {
    chainId: dUint("chainId", chainId, 64),
    nonceKeys: asList("nonceKeys", nonceKeys).map((k, i) => dUint(`nonceKeys[${i}]`, k, 256)),
    nonceSeq: dUint("nonceSeq", nonceSeq, 64),
    sender: dBytes("sender", sender, 20),
    frames: asList("frames", frames).map(dFrame),
    signatures: asList("signatures", signatures).map(dSignature),
    fees: {
      maxPriorityFeePerGas: dUint("fees.maxPriorityFeePerGas", prio, 64),
      maxFeePerGas: dUint("fees.maxFeePerGas", maxFee, 64),
      maxFeePerBlobGas: dUint("fees.maxFeePerBlobGas", blobFee, 256),
    },
    blobHashes: asList("blobHashes", blobHashes).map((h, i) => dBytes(`blobHashes[${i}]`, h, 32)),
    recentRootReferences: asList("recentRootReferences", roots).map(dRoot),
  };
}

// ---------------------------------------------------------------- hashes

/** Tx hash = keccak256 of the exact wire bytes (see the test vectors). */
export function txHash(raw: Hex | FrameTx, opts: SerializeOptions = {}): Hex {
  return keccak256(typeof raw === "string" ? raw : serializeFrameTx(raw, opts));
}

/**
 * Signature hash (SPEC §6): keccak256(0x06 || rlp(tx)) where every
 * signature entry with an empty `msg` has its `signature` bytes replaced by empty bytes.
 * Everything else, including all frame data (VERIFY frames too), is covered.
 */
export function signatureHash(tx: FrameTx | Hex, opts: SerializeOptions = {}): Hex {
  const t = typeof tx === "string" ? parseFrameTx(tx) : tx;
  const elided: FrameTx = {
    ...t,
    signatures: t.signatures.map((s) => (s.msg === "0x" ? { ...s, signature: "0x" } : s)),
  };
  return keccak256(serializeBytes(elided, opts.unsafe === true));
}

// ---------------------------------------------------------------- signing helpers

/** Anything that can sign a raw 32-byte hash (a viem local account). */
export type HashSigner = Pick<LocalAccount, "address"> & { sign: NonNullable<LocalAccount["sign"]> };

/** An ARBITRARY entry (empty signer and msg). With empty bytes it is the 100-gas placeholder used at index 0 of an EOA-payer transaction. */
export function arbitraryEntry(signature: Hex = "0x"): SignatureEntry {
  return { scheme: SignatureScheme.ARBITRARY, signer: null, msg: "0x", signature };
}

/**
 * Signs the tx's signature hash with `account` and puts a SECP256K1 entry
 * `{ signer: account, msg: "0x", signature: yParity || r || s }` at `signatures[index]`
 * (replacing it, or appending when `index === signatures.length`); `{ explicitSigner: false }`
 * leaves `signer` empty (= tx.sender). This is what the
 * default code of an EOA VERIFY frame checks (SPEC §4: index 0 for execution scope,
 * index 1 for payment-only). Because `msg` is empty the entry's own bytes are elided from
 * the hash, so entries can be signed in any order. Returns a new tx.
 */
export interface SignEntryOptions {
  /**
   * Put the account's address in `signer` (default true). With false, `signer` is empty,
   * which resolves to tx.sender, so only use it when the account IS tx.sender.
   */
  explicitSigner?: boolean;
}

export async function signSecp256k1Entry(tx: FrameTx, index: number, account: HashSigner, opts: SignEntryOptions = {}): Promise<FrameTx> {
  if (!Number.isInteger(index) || index < 0 || index > tx.signatures.length) {
    throw new FrameTxEncodeError(`signatures[${index}]: index out of range (have ${tx.signatures.length}; fill earlier slots first, e.g. with arbitraryEntry())`);
  }
  const signer = opts.explicitSigner === false ? null : (account.address.toLowerCase() as Address);
  const placeholder: SignatureEntry = { scheme: SignatureScheme.SECP256K1, signer, msg: "0x", signature: "0x" };
  const signatures = [...tx.signatures];
  signatures[index] = placeholder;
  const unsigned: FrameTx = { ...tx, signatures };
  const sig = parseSignature(await account.sign({ hash: signatureHash(unsigned) }));
  const yParity = sig.yParity ?? Number(sig.v! - 27n);
  const packed = `0x${yParity.toString(16).padStart(2, "0")}${sig.r.slice(2).padStart(64, "0")}${sig.s.slice(2).padStart(64, "0")}` as Hex;
  signatures[index] = { ...placeholder, signature: packed };
  return { ...tx, signatures };
}
