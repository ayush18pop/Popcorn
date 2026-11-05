// An independent reference for the SDK's offline tests. It reads the argument layout from contracts/core/LAYOUT.md and
// the Core build from contracts/core/out, and builds rule-pays triggers from first principles, so the SDK's own encoder
// and builder are checked against a second implementation rather than against themselves.
import { readFileSync } from "node:fs";
import { concat, encodeFunctionData, numberToHex, pad, parseAbi, toHex, type Address, type Hex } from "viem";
import { FrameFlags, FrameMode, type Frame, type FrameTx } from "../src/index.ts";

const ROOT = new URL("../../../", import.meta.url).pathname;

// ---------------------------------------------------------------- LAYOUT.md
export interface ArgField {
  offset: number;
  bytes: number;
  name: string;
  type: string;
  meaning: string;
}
export interface CoreCode {
  code: number;
  /** "VERIFY", "VERIFY1" (caller-pays), "SENDER", "FORWARD" or "OWNER" (the table's section) */
  section: string;
  check: string;
}
export interface Layout {
  argsLength: number;
  fields: ArgField[];
  codes: CoreCode[];
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
const unticks = (s: string) => s.replace(/`/g, "");

export function parseLayout(md: string): Layout {
  const fields: ArgField[] = [];
  const codes: CoreCode[] = [];
  let section = "";
  let table: "args" | "codes" | null = null;
  for (const line of md.split("\n")) {
    if (/^#{2,4} /.test(line)) {
      section = line.replace(/^#+ /, "");
      table = null;
      continue;
    }
    if (!line.trim().startsWith("|")) {
      table = null;
      continue;
    }
    const c = cells(line);
    if (c.every((x) => /^:?-+:?$/.test(x))) continue;
    if (c[0] === "Offset" && c[2] === "Name") {
      table = "args";
      continue;
    }
    if (c[0] === "Code" && c.includes("Check")) {
      table = "codes";
      continue;
    }
    if (table === "args" && c.length >= 5) {
      fields.push({ offset: Number(c[0]), bytes: Number(c[1]), name: unticks(c[2]!), type: unticks(c[3]!), meaning: c[4]! });
    } else if (table === "codes") {
      const sec = /^FORWARD/i.test(section) ? "FORWARD" : /^OWNER path/i.test(section) ? "OWNER" : /caller-pays/i.test(section) ? "VERIFY1" : /SENDER/i.test(section) ? "SENDER" : "VERIFY";
      const range = unticks(c[0]!).match(/^0x([0-9a-f]+)(?:\s*[-–]\s*0x([0-9a-f]+))?$/i);
      if (!range) continue;
      const lo = parseInt(range[1]!, 16);
      const hi = range[2] ? parseInt(range[2], 16) : lo;
      for (let k = lo; k <= hi; k++) codes.push({ code: k, section: sec, check: unticks(c[c.length - 1]!) });
    }
  }
  if (fields.length === 0) throw new Error("LAYOUT.md: no argument layout table found");
  fields.reduce((off, f) => {
    if (f.offset !== off) throw new Error(`LAYOUT.md: field ${f.name} at ${f.offset}, expected ${off} (packed)`);
    return off + f.bytes;
  }, 0);
  return { argsLength: fields.reduce((n, f) => Math.max(n, f.offset + f.bytes), 0), fields, codes };
}

export const loadLayout = (path = `${ROOT}contracts/core/LAYOUT.md`): Layout => parseLayout(readFileSync(path, "utf8"));
export const layout = loadLayout();

/** Packs the immutable args in layout order. Every field must be given (by its LAYOUT.md name). */
export function encodeArgs(l: Layout, values: Record<string, bigint | number | Hex>): Hex {
  const parts: Hex[] = [];
  for (const f of l.fields) {
    const v = values[f.name];
    if (v === undefined) throw new Error(`immutable arg "${f.name}" (${f.meaning}) has no value`);
    if (typeof v === "string") {
      if ((v.length - 2) / 2 !== f.bytes) throw new Error(`arg ${f.name}: ${v} is not ${f.bytes} bytes`);
      parts.push(v.toLowerCase() as Hex);
    } else {
      const n = BigInt(v);
      if (n < 0n || n >= 1n << BigInt(8 * f.bytes)) throw new Error(`arg ${f.name}: ${n} does not fit ${f.bytes} bytes`);
      parts.push(pad(numberToHex(n), { size: f.bytes }));
    }
  }
  return concat(parts);
}

/** Decodes deployed args (the code tail) back into named values. */
export function decodeArgs(l: Layout, args: Hex): Record<string, bigint> {
  const b = args.slice(2);
  const out: Record<string, bigint> = {};
  for (const f of l.fields) out[f.name] = BigInt(`0x${b.slice(f.offset * 2, (f.offset + f.bytes) * 2) || "0"}`);
  return out;
}

// ---------------------------------------------------------------- Core build
export function loadCore(): { creation: Hex; runtime: Hex; nonceKeyGas: bigint; verifyFixedGas: bigint } {
  const j = JSON.parse(readFileSync(`${ROOT}contracts/core/out/PopcornCore.json`, "utf8"));
  return { creation: j.creation, runtime: j.runtime, nonceKeyGas: BigInt(j.constants.nonceKeyGas), verifyFixedGas: BigInt(j.constants.verifyFixedGas) };
}

/** Values for args other than logic/mode, by LAYOUT.md name. */
export const DEFAULT_ARGS: Record<string, bigint | number | Hex> = {
  maxFeePerGas: 3_000_000_000n,
  maxPriorityFeePerGas: 2_000_000_000n,
  maxGasPerFrame: 90_000n,
  maxStateGasPerFrame: 100_000n,
  verifier: "0x0000000000000000000000000000000000000000",
  conditionGas: 20_000n,
  maxVerifyDataLength: 1024n,
  maxTriggerDataLength: 1024n,
};

export const coreArgs = (logic: Address, mode: number, caps: Record<string, bigint | number | Hex> = {}): Hex =>
  encodeArgs(layout, { ...DEFAULT_ARGS, ...caps, logic, mode });

// ---------------------------------------------------------------- triggers
const ABI = parseAbi(["function pop(bytes popArgs)"]);
const popData = (triggerData: Hex): Hex => encodeFunctionData({ abi: ABI, functionName: "pop", args: [triggerData] });

/** A deployed rule contract as the reference builder sees it. */
export interface RefRule {
  address: Address;
  values: Record<string, bigint>;
  keyOf: (triggerData: Hex) => Promise<bigint>;
}

export interface TriggerOverrides {
  triggerData?: Hex;
  verifyData?: Hex;
  verifyGas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  chainId?: bigint;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** Core's VERIFY floor (LAYOUT.md "VERIFY floor", check 0x27) for verifyData / SENDER data of these sizes. */
export function verifyFloor(values: Record<string, bigint>, verifyData: Hex, senderData: Hex): bigint {
  const c = loadCore();
  const cg = values.conditionGas!;
  return c.nonceKeyGas + cg + cg / 63n + c.verifyFixedGas + BigInt((verifyData.length - 2) / 2) + BigInt((senderData.length - 2) / 2);
}

/**
 * Rule-pays trigger with defaults derived from the rule contract's caps:
 * [VERIFY flags 3 → self, exec min(cap, max(60k, floor)), state 0, data verifyData]
 * [SENDER flags 0 → self, exec = cap, state = cap, data pop(triggerData)]
 * fees min(cap, 2 gwei) / min(cap, 1 gwei); nonce key = the logic's key; seq 0; no signatures.
 */
export async function buildTrigger(r: RefRule, o: TriggerOverrides = {}): Promise<{ tx: FrameTx; triggerData: Hex }> {
  const triggerData = o.triggerData ?? toHex("reference");
  const v = r.values;
  const senderData = popData(triggerData);
  const verifyGas = o.verifyGas ?? min(v.maxGasPerFrame!, max(60_000n, verifyFloor(v, o.verifyData ?? "0x", senderData)));
  const frames: Frame[] = [
    { mode: FrameMode.VERIFY, flags: FrameFlags.APPROVE_EXECUTION_AND_PAYMENT, target: null, gasLimit: verifyGas, stateGasLimit: 0n, value: 0n, data: o.verifyData ?? "0x" },
    { mode: FrameMode.SENDER, flags: FrameFlags.NONE, target: null, gasLimit: v.maxGasPerFrame!, stateGasLimit: v.maxStateGasPerFrame!, value: 0n, data: senderData },
  ];
  return {
    tx: {
      chainId: o.chainId ?? 1337n,
      nonceKeys: [await r.keyOf(triggerData)],
      nonceSeq: 0n,
      sender: r.address,
      frames,
      signatures: [],
      fees: { maxPriorityFeePerGas: o.maxPriorityFeePerGas ?? min(v.maxPriorityFeePerGas!, 1_000_000_000n), maxFeePerGas: o.maxFeePerGas ?? min(v.maxFeePerGas!, 2_000_000_000n), maxFeePerBlobGas: 0n },
      blobHashes: [],
      recentRootReferences: [],
    },
    triggerData,
  };
}

/** A minimal valid rule-pays trigger, built by hand (no SDK helpers). */
export function minimalTrigger(ruleContract: Address, nonceKey: bigint): FrameTx {
  return {
    chainId: 1337n,
    nonceKeys: [nonceKey],
    nonceSeq: 0n,
    sender: ruleContract,
    frames: [
      { mode: FrameMode.VERIFY, flags: FrameFlags.APPROVE_EXECUTION_AND_PAYMENT, target: null, gasLimit: 80_000n, stateGasLimit: 0n, value: 0n, data: "0x" },
      { mode: FrameMode.SENDER, flags: FrameFlags.NONE, target: null, gasLimit: 200_000n, stateGasLimit: 400_000n, value: 0n, data: pad(toHex(0xc0ffee), { size: 32 }) },
    ],
    signatures: [],
    fees: { maxPriorityFeePerGas: 1_000_000_000n, maxFeePerGas: 2_000_000_000n, maxFeePerBlobGas: 0n },
    blobHashes: [],
    recentRootReferences: [],
  };
}
