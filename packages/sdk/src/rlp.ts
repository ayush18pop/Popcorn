// Minimal RLP with a strict (canonical-only) decoder.
// Rejected on decode: a single byte < 0x80 wrapped as a 1-byte string, long-form lengths
// that fit the short form, length prefixes with leading zero bytes, truncated items and
// trailing bytes after the top-level item.
import { FrameTxDecodeError } from "./errors.ts";

export type RlpItem = Uint8Array | RlpItem[];

function encodeLength(len: number, offset: number): Uint8Array {
  if (len <= 55) return Uint8Array.of(offset + len);
  const lenBytes: number[] = [];
  for (let n = len; n > 0; n = Math.floor(n / 256)) lenBytes.unshift(n % 256);
  return Uint8Array.of(offset + 55 + lenBytes.length, ...lenBytes);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

export function rlpEncode(item: RlpItem): Uint8Array {
  if (item instanceof Uint8Array) {
    if (item.length === 1 && item[0]! < 0x80) return item;
    return concat([encodeLength(item.length, 0x80), item]);
  }
  const body = concat(item.map(rlpEncode));
  return concat([encodeLength(body.length, 0xc0), body]);
}

function fail(msg: string): never {
  throw new FrameTxDecodeError(`RLP: ${msg}`);
}

function readLength(buf: Uint8Array, pos: number, lenOfLen: number): number {
  if (pos + lenOfLen > buf.length) fail("truncated length prefix");
  if (buf[pos] === 0) fail("length prefix has a leading zero byte");
  let len = 0;
  for (let i = 0; i < lenOfLen; i++) len = len * 256 + buf[pos + i]!;
  if (len <= 55) fail("long-form length used for a length <= 55");
  if (!Number.isSafeInteger(len)) fail("length too large");
  return len;
}

/** Decodes one item at `pos`; returns it and the position after it. */
function decodeAt(buf: Uint8Array, pos: number): [RlpItem, number] {
  if (pos >= buf.length) fail("unexpected end of input");
  const b = buf[pos]!;
  if (b < 0x80) return [buf.subarray(pos, pos + 1), pos + 1];
  if (b <= 0xb7) {
    const len = b - 0x80;
    const start = pos + 1;
    if (start + len > buf.length) fail("truncated string");
    if (len === 1 && buf[start]! < 0x80) fail("single byte < 0x80 must not be wrapped");
    return [buf.subarray(start, start + len), start + len];
  }
  if (b <= 0xbf) {
    const lenOfLen = b - 0xb7;
    const len = readLength(buf, pos + 1, lenOfLen);
    const start = pos + 1 + lenOfLen;
    if (start + len > buf.length) fail("truncated string");
    return [buf.subarray(start, start + len), start + len];
  }
  let len: number;
  let start: number;
  if (b <= 0xf7) {
    len = b - 0xc0;
    start = pos + 1;
  } else {
    const lenOfLen = b - 0xf7;
    len = readLength(buf, pos + 1, lenOfLen);
    start = pos + 1 + lenOfLen;
  }
  const end = start + len;
  if (end > buf.length) fail("truncated list");
  const items: RlpItem[] = [];
  let p = start;
  while (p < end) {
    const [item, next] = decodeAt(buf, p);
    if (next > end) fail("list item overruns its list");
    items.push(item);
    p = next;
  }
  return [items, end];
}

/** Decodes exactly one top-level item spanning all of `buf`. */
export function rlpDecode(buf: Uint8Array): RlpItem {
  const [item, end] = decodeAt(buf, 0);
  if (end !== buf.length) fail(`${buf.length - end} trailing byte(s) after the top-level item`);
  return item;
}
