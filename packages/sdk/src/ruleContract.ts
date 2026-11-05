// Pure rule contract helpers (rule-pays mode 0 and, since Core, caller-pays mode 1): the 101-byte Core args (contracts/core/LAYOUT.md), parsing them from a rule contract's code, the VERIFY
// floor, cost bounds, the factory's deploy bounds (mirrored from RuleFactory.checkArgs), and the exact 2-frame trigger.
// No network here; src/actions.ts adds the RPC.
import { concat, encodeAbiParameters, encodePacked, getAddress, size, toHex, toRlp, type Address, type Hex } from "viem";
import { CORE_BUILDS, type CoreArtifact } from "./deployments.ts";
import { PopcornError } from "./errors.ts";
import { FrameFlags, FrameMode, SignatureScheme, type Frame, type FrameTx } from "./types.ts";

/** RuleFactory.RuleContractArgs = the 101 packed Core args, same order (contracts/core/LAYOUT.md "Argument layout"). */
export interface RuleContractArgs {
  logic: Address;
  /** 0 = rule-pays, 1 = caller-pays (Core). */
  mode: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Frame 0 (VERIFY) limit ≤ it; frame 1 (SENDER) limit == it. */
  maxGasPerFrame: bigint;
  /** Frame 1 state limit == it; frame 0 state limit == 0. */
  maxStateGasPerFrame: bigint;
  verifier: Address;
  conditionGas: number;
  maxVerifyDataLength: number;
  maxTriggerDataLength: number;
}

export const ARGS_LENGTH = 101;
export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
/** One fresh storage slot of state gas. */
export const STATE_SLOT_GAS = 97_920n;

/** The 101 packed bytes (== RuleFactory.encodeArgs). */
export function encodeRuleContractArgs(a: RuleContractArgs): Hex {
  return encodePacked(
    ["address", "uint8", "uint128", "uint128", "uint64", "uint64", "address", "uint32", "uint32", "uint32"],
    [a.logic, a.mode, a.maxFeePerGas, a.maxPriorityFeePerGas, a.maxGasPerFrame, a.maxStateGasPerFrame, a.verifier, a.conditionGas, a.maxVerifyDataLength, a.maxTriggerDataLength],
  );
}

export function decodeRuleContractArgs(args: Hex): RuleContractArgs {
  if (size(args) !== ARGS_LENGTH) throw new PopcornError(`rule contract args must be ${ARGS_LENGTH} bytes, got ${size(args)}`);
  const b = args.slice(2);
  const f = (off: number, n: number) => BigInt(`0x${b.slice(off * 2, (off + n) * 2)}`);
  const addr = (off: number) => getAddress(`0x${b.slice(off * 2, (off + 20) * 2)}`);
  return {
    logic: addr(0),
    mode: Number(f(20, 1)),
    maxFeePerGas: f(21, 16),
    maxPriorityFeePerGas: f(37, 16),
    maxGasPerFrame: f(53, 8),
    maxStateGasPerFrame: f(61, 8),
    verifier: addr(69),
    conditionGas: Number(f(89, 4)),
    maxVerifyDataLength: Number(f(93, 4)),
    maxTriggerDataLength: Number(f(97, 4)),
  };
}

export interface ParsedRule {
  args: RuleContractArgs;
  /** The raw 101-byte tail. */
  argsHex: Hex;
  core: CoreArtifact;
}

/**
 * Parses a rule contract's deployed code: it must be `runtime ++ 101 args` for a known Core build (CORE_BUILDS). Detection is
 * by code shape only (never by how the rule contract answers a normal call: Core forwards those to the logic).
 */
export function parseRuleContractCode(code: Hex | undefined, builds: readonly CoreArtifact[] = CORE_BUILDS): ParsedRule | null {
  if (!code || code === "0x") return null;
  const c = code.toLowerCase();
  for (const core of builds) {
    const rt = core.runtime.toLowerCase();
    if (c.length === rt.length + ARGS_LENGTH * 2 && c.startsWith(rt)) {
      const argsHex = `0x${c.slice(rt.length)}` as Hex;
      return { args: decodeRuleContractArgs(argsHex), argsHex, core };
    }
  }
  return null;
}

const ceil32 = (n: bigint) => ((n + 31n) / 32n) * 32n;
/** Length of the SENDER calldata `pop(bytes)` for triggerData of n bytes: 4 + 32 + 32 + ceil32(n). */
export const triggerCalldataLength = (triggerDataLength: number | bigint) => 68n + ceil32(BigInt(triggerDataLength));

/** Canonical SENDER frame data: `pop(bytes)` selector ‖ 0x20 ‖ len ‖ triggerData ‖ zero padding (contracts/core/ABI.md). */
export function triggerCalldata(triggerData: Hex, core: CoreArtifact = CORE_BUILDS[0]!): Hex {
  return concat([core.selectors.pop, encodeAbiParameters([{ type: "bytes" }], [triggerData])]);
}

/** Core's VERIFY floor (check 0x27): 10,000 + cg + cg/63 + 7,000 + n0 + n1 (contracts/core/LAYOUT.md "VERIFY floor"). */
export function verifyFloor(a: Pick<RuleContractArgs, "conditionGas">, verifyDataLength: number | bigint, senderDataLength: number | bigint, core: CoreArtifact = CORE_BUILDS[0]!): bigint {
  const cg = BigInt(a.conditionGas);
  return core.constants.nonceKeyGas + cg + cg / 63n + core.constants.verifyFixedGas + BigInt(verifyDataLength) + BigInt(senderDataLength);
}

/** == RuleFactory.verifyFloorAtCaps. */
export function verifyFloorAtCaps(a: Pick<RuleContractArgs, "conditionGas" | "maxVerifyDataLength" | "maxTriggerDataLength">, core?: CoreArtifact): bigint {
  return verifyFloor(a, a.maxVerifyDataLength, triggerCalldataLength(a.maxTriggerDataLength), core);
}

/** Mode 1 (RuleFactory.MANDATORY_GAS_CALLER_PAYS / PAYER_FRAME_GAS): intrinsic with 4 frames + EOA payer signatures,
 *  and the execution limit budgeted for the payer frame and for a tail in the EIP-7825 bound. */
export const CALLER_PAYS_MANDATORY_GAS = 16_800n;
export const PAYER_FRAME_GAS = 30_000n;

/** == RuleFactory.minTxExecutionGas (EIP-7825 check). */
export function minTxExecutionGas(a: Pick<RuleContractArgs, "conditionGas" | "maxVerifyDataLength" | "maxTriggerDataLength" | "maxGasPerFrame"> & { mode?: number }, core: CoreArtifact = CORE_BUILDS[0]!): bigint {
  const n1 = triggerCalldataLength(a.maxTriggerDataLength);
  if (a.mode === 1) return CALLER_PAYS_MANDATORY_GAS + 16n * (BigInt(a.maxVerifyDataLength) + n1 + 35n + 150n) + verifyFloorAtCaps(a, core) + a.maxGasPerFrame + 2n * PAYER_FRAME_GAS;
  return core.constants.mandatoryGas + 16n * (BigInt(a.maxVerifyDataLength) + n1 + 35n) + verifyFloorAtCaps(a, core) + a.maxGasPerFrame;
}

/** == RuleCosts.maxGasPerTrigger: total_gas_limit bound of any trigger the rule contract accepts. */
export function maxGasPerTrigger(a: Pick<RuleContractArgs, "maxGasPerFrame" | "maxStateGasPerFrame" | "maxVerifyDataLength" | "maxTriggerDataLength">, core: CoreArtifact = CORE_BUILDS[0]!): bigint {
  const n1 = triggerCalldataLength(a.maxTriggerDataLength);
  return core.constants.mandatoryGas + core.constants.floorPerByte * (BigInt(a.maxVerifyDataLength) + n1 + core.constants.nonceRlpBytes) + 2n * a.maxGasPerFrame + a.maxStateGasPerFrame;
}

/**
 * == RuleFactory.maxCostPerTrigger: worst-case wei one trigger can reserve. This is the rule contract's minimum operating balance
 *: ethrex reserves max_cost from the rule contract before any frame runs and refunds the unused part.
 */
export function maxCostPerTrigger(a: Pick<RuleContractArgs, "maxFeePerGas" | "maxGasPerFrame" | "maxStateGasPerFrame" | "maxVerifyDataLength" | "maxTriggerDataLength"> & { mode?: number }, core?: CoreArtifact): bigint {
  if (a.mode === 1) return 0n; // caller-pays: the payer pays every trigger
  return a.maxFeePerGas * maxGasPerTrigger(a, core);
}

/** EOA payer signature cost in the prefix budget (ARBITRARY 100 + SECP256K1 2,800). */
export const EOA_PAYER_SIG_GAS = 2_900n;
/** Public ethrex / upstream sidecar prefix budget (contracts/core/SPEC.md §9); local / patched sidecars: 250k / 2.5M. */
export const PUBLIC_PREFIX_BUDGET = 100_000n;

/** == RuleFactory.prefixGasAtCaps: smallest prefix gas of a trigger at the data caps (mode 1: + payer frame + EOA sigs). */
export function prefixGasAtCaps(a: Pick<RuleContractArgs, "conditionGas" | "maxVerifyDataLength" | "maxTriggerDataLength" | "mode">, core?: CoreArtifact): bigint {
  const floor = verifyFloorAtCaps(a, core);
  return a.mode === 1 ? floor + PAYER_FRAME_GAS + EOA_PAYER_SIG_GAS : floor;
}

// ---------------------------------------------------------------- factory bounds (mirror of RuleFactory.checkArgs)

export const FACTORY_BOUNDS = {
  MAX_FEE_CEILING: 1_000_000_000_000n, // 1,000 gwei
  MAX_GAS_PER_FRAME: 16_777_216n,
  MIN_CONDITION_GAS: 5_000,
  MAX_STATE_GAS_PER_FRAME: 64n * STATE_SLOT_GAS,
  MAX_VERIFY_DATA_LENGTH: 8_192,
  MAX_TRIGGER_DATA_LENGTH: 4_096,
  TX_GAS_CAP: 16_777_216n,
} as const;

/** The factory's custom error name for the first bound broken, or null (code-existence and stake checks need RPC). */
export function checkRuleContractArgsLocal(a: RuleContractArgs, core?: CoreArtifact): string | null {
  const B = FACTORY_BOUNDS;
  if (a.mode !== 0 && a.mode !== 1) return "ModeNotSupported";
  if (a.mode === 1) {
    if (a.maxFeePerGas !== 0n || a.maxPriorityFeePerGas !== 0n) return "FeeCapsMustBeZeroInCallerPays";
  } else {
    if (a.maxFeePerGas === 0n || a.maxFeePerGas > B.MAX_FEE_CEILING) return "MaxFeeOutOfRange";
    if (a.maxPriorityFeePerGas > a.maxFeePerGas) return "PriorityFeeAboveMaxFee";
  }
  if (a.maxGasPerFrame > B.MAX_GAS_PER_FRAME) return "GasPerFrameTooHigh";
  if (a.maxStateGasPerFrame > B.MAX_STATE_GAS_PER_FRAME) return "StateGasTooHigh";
  if (a.maxVerifyDataLength > B.MAX_VERIFY_DATA_LENGTH) return "VerifyDataTooLong";
  if (a.maxTriggerDataLength > B.MAX_TRIGGER_DATA_LENGTH) return "TriggerDataTooLong";
  if (a.conditionGas < B.MIN_CONDITION_GAS) return "ConditionGasTooLow";
  if (verifyFloorAtCaps(a, core) > a.maxGasPerFrame) return "VerifyFloorAboveGasPerFrame";
  if (minTxExecutionGas(a, core) > B.TX_GAS_CAP) return "TxGasAboveCap";
  return null;
}

// ---------------------------------------------------------------- default caps

export interface RuleContractCaps {
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  maxGasPerFrame?: bigint;
  maxStateGasPerFrame?: bigint;
  verifier?: Address;
  conditionGas?: number;
  maxVerifyDataLength?: number;
  maxTriggerDataLength?: number;
}

export interface CapDefaultsInput {
  logic: Address;
  /** Current base fee (wei). */
  baseFee: bigint;
  /** Suggested priority fee (eth_maxPriorityFeePerGas). */
  suggestedTip: bigint;
  /** maxFeePerGas cap = 2 × tip cap + baseFee × this (default 20: survives a long base-fee climb). */
  baseFeeMultiplier?: bigint;
  caps?: RuleContractCaps;
  core?: CoreArtifact;
  /** 0 rule-pays (default), 1 caller-pays: fee caps are 0 (unused by Core mode 1). */
  mode?: number;
}

export const DEFAULT_CAPS = {
  conditionGas: 20_000,
  maxVerifyDataLength: 0,
  maxTriggerDataLength: 128,
  /** SENDER budget; raised to the VERIFY floor at the data caps if that is larger. */
  maxGasPerFrame: 200_000n,
  /** two fresh storage slots */
  maxStateGasPerFrame: 2n * STATE_SLOT_GAS,
  /** minimum tip cap */
  minPriorityFeeCap: 2_000_000_000n,
} as const;

/**
 * Sane rule contract args from the current fees and the given caps (any field given wins):
 * - tip cap = max(2 × suggested tip, 2 gwei); fee cap = 2 × tip cap + baseFee × 20 (≤ 1,000 gwei)
 * - conditionGas 20,000; maxVerifyDataLength 0 (set it if the condition reads verifyData); maxTriggerDataLength 128
 * - maxGasPerFrame max(200,000, VERIFY floor at the data caps); maxStateGasPerFrame 2 × 97,920
 * The result satisfies the factory's bounds whenever the given caps allow it (checkRuleContractArgsLocal).
 */
export function defaultRuleContractArgs(i: CapDefaultsInput): RuleContractArgs {
  const c = i.caps ?? {};
  const tip2 = 2n * i.suggestedTip;
  const tipCap = c.maxPriorityFeePerGas ?? (tip2 > DEFAULT_CAPS.minPriorityFeeCap ? tip2 : DEFAULT_CAPS.minPriorityFeeCap);
  let feeCap = c.maxFeePerGas ?? 2n * tipCap + i.baseFee * (i.baseFeeMultiplier ?? 20n);
  if (c.maxFeePerGas === undefined && feeCap > FACTORY_BOUNDS.MAX_FEE_CEILING) feeCap = FACTORY_BOUNDS.MAX_FEE_CEILING;
  const partial = {
    conditionGas: c.conditionGas ?? DEFAULT_CAPS.conditionGas,
    maxVerifyDataLength: c.maxVerifyDataLength ?? DEFAULT_CAPS.maxVerifyDataLength,
    maxTriggerDataLength: c.maxTriggerDataLength ?? DEFAULT_CAPS.maxTriggerDataLength,
  };
  const floor = verifyFloorAtCaps(partial, i.core);
  const sp = i.mode === 1;
  return {
    logic: i.logic,
    mode: sp ? 1 : 0,
    maxFeePerGas: sp ? 0n : feeCap,
    maxPriorityFeePerGas: sp ? 0n : (c.maxPriorityFeePerGas ?? (tipCap > feeCap ? feeCap : tipCap)),
    maxGasPerFrame: c.maxGasPerFrame ?? (floor > DEFAULT_CAPS.maxGasPerFrame ? floor : DEFAULT_CAPS.maxGasPerFrame),
    maxStateGasPerFrame: c.maxStateGasPerFrame ?? DEFAULT_CAPS.maxStateGasPerFrame,
    verifier: c.verifier ?? ZERO_ADDRESS,
    ...partial,
  };
}

// ---------------------------------------------------------------- the trigger

export interface TriggerTxInput {
  ruleContract: Address;
  args: Pick<RuleContractArgs, "maxGasPerFrame" | "maxStateGasPerFrame">;
  chainId: bigint;
  triggerData: Hex;
  verifyData: Hex;
  nonceKey: bigint;
  /** Frame 0 execution limit. */
  verifyGasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  core?: CoreArtifact;
}

/**
 * The exact rule-pays trigger (contracts/core/LAYOUT.md):
 *   frame 0: VERIFY, flags 3, target null (= sender = rule contract), exec verifyGasLimit, state 0, value 0, data verifyData
 *   frame 1: SENDER, flags 0, target null, exec = maxGasPerFrame, state = maxStateGasPerFrame, value 0, data pop(triggerData)
 *   sender = rule contract, nonce_keys [key], nonce_seq 0, no signatures, no blobs, no recent roots.
 */
export function buildTriggerTx(i: TriggerTxInput): FrameTx {
  return {
    chainId: i.chainId,
    nonceKeys: [i.nonceKey],
    nonceSeq: 0n,
    sender: getAddress(i.ruleContract),
    frames: [
      { mode: FrameMode.VERIFY, flags: FrameFlags.APPROVE_EXECUTION_AND_PAYMENT, target: null, gasLimit: i.verifyGasLimit, stateGasLimit: 0n, value: 0n, data: i.verifyData },
      { mode: FrameMode.SENDER, flags: FrameFlags.NONE, target: null, gasLimit: i.args.maxGasPerFrame, stateGasLimit: i.args.maxStateGasPerFrame, value: 0n, data: triggerCalldata(i.triggerData, i.core) },
    ],
    signatures: [],
    fees: { maxPriorityFeePerGas: i.maxPriorityFeePerGas, maxFeePerGas: i.maxFeePerGas, maxFeePerBlobGas: 0n },
    blobHashes: [],
    recentRootReferences: [],
  };
}

// ---------------------------------------------------------------- the caller-pays trigger (Core mode 1)

/** An optional DEFAULT frame after the action (frame 3): the payer's own follow-up. Must not target the rule contract (0x49). */
export interface TriggerTail {
  target: Address;
  data: Hex;
  gasLimit: bigint;
  stateGasLimit?: bigint;
}

export interface CallerPaysTriggerTxInput extends TriggerTxInput {
  payer: Address;
  /** Frame 1 (payer VERIFY) execution limit; must cover the 20,000 first-use charge of the rule contract's key (SPEC §7). */
  payerGasLimit: bigint;
  /** "eoa" (default): signatures = [ARBITRARY placeholder, SECP256K1 payer (unsigned; sign with signSecp256k1Entry(tx, 1, payer))].
   *  "contract": no signatures (the payer contract's code decides). */
  payerKind?: "eoa" | "contract";
  tail?: TriggerTail;
}

/**
 * msg of the ARBITRARY placeholder at signatures[0] (EOA payer): keccak256("popcorn.senderpays.placeholder").
 * Non-empty, so the entry's signature bytes are INCLUDED in the sig hash the payer signs: with an empty msg anyone could
 * pad them (they were elided) and make the payer pay for kilobytes of junk.
 */
export const PAYER_PLACEHOLDER_MSG: Hex = "0xa4f2ffde1be9b205373e957e6b76a6d53c7e7885a862af122e377acebde541f9";

/** Default payer frame limit for an EOA payer: default code used 3,000 in the recorded EOA-payer transaction, + the 20,000 nonce first-use budget. */
export const DEFAULT_PAYER_GAS_LIMIT = 30_000n;

/**
 * The exact caller-pays trigger (contracts/core/LAYOUT.md "VERIFY, caller-pays", as in the recorded EOA-payer transaction):
 *   frame 0: VERIFY, flags 2, target null (= rule contract), exec verifyGasLimit, state 0, data verifyData   (approves execution)
 *   frame 1: VERIFY, flags 1, target payer, exec payerGasLimit, state 0, data empty                    (approves payment)
 *   frame 2: SENDER, flags 0, target null, exec = maxGasPerFrame, state = maxStateGasPerFrame, data pop(triggerData)
 *   frame 3: optional DEFAULT, flags 0, target tail.target (≠ rule contract), value 0
 *   sender = rule contract, nonce_keys [key], seq 0. EOA payer: signatures [ARBITRARY msg=PAYER_PLACEHOLDER_MSG (signed),
 *   SECP256K1 signer=payer, msg empty]
 *   — the payer must sign signatures[1] last (signSecp256k1Entry(tx, 1, payer)); the hash covers every frame.
 */
export function buildCallerPaysTriggerTx(i: CallerPaysTriggerTxInput): FrameTx {
  const frames: Frame[] = [
    { mode: FrameMode.VERIFY, flags: FrameFlags.APPROVE_EXECUTION, target: null, gasLimit: i.verifyGasLimit, stateGasLimit: 0n, value: 0n, data: i.verifyData },
    { mode: FrameMode.VERIFY, flags: FrameFlags.APPROVE_PAYMENT, target: getAddress(i.payer), gasLimit: i.payerGasLimit, stateGasLimit: 0n, value: 0n, data: "0x" },
    { mode: FrameMode.SENDER, flags: FrameFlags.NONE, target: null, gasLimit: i.args.maxGasPerFrame, stateGasLimit: i.args.maxStateGasPerFrame, value: 0n, data: triggerCalldata(i.triggerData, i.core) },
  ];
  if (i.tail) {
    if (getAddress(i.tail.target) === getAddress(i.ruleContract)) throw new PopcornError("tail must not target the rule contract (Core 0x49)");
    frames.push({ mode: FrameMode.DEFAULT, flags: FrameFlags.NONE, target: getAddress(i.tail.target), gasLimit: i.tail.gasLimit, stateGasLimit: i.tail.stateGasLimit ?? 0n, value: 0n, data: i.tail.data });
  }
  if (getAddress(i.payer) === getAddress(i.ruleContract)) throw new PopcornError("payer must not be the rule contract (Core 0x43)");
  return {
    chainId: i.chainId,
    nonceKeys: [i.nonceKey],
    nonceSeq: 0n,
    sender: getAddress(i.ruleContract),
    frames,
    signatures:
      (i.payerKind ?? "eoa") === "eoa"
        ? [
            { scheme: SignatureScheme.ARBITRARY, signer: null, msg: PAYER_PLACEHOLDER_MSG, signature: "0x" },
            { scheme: SignatureScheme.SECP256K1, signer: getAddress(i.payer).toLowerCase() as Address, msg: "0x", signature: "0x" },
          ]
        : [],
    fees: { maxPriorityFeePerGas: i.maxPriorityFeePerGas, maxFeePerGas: i.maxFeePerGas, maxFeePerBlobGas: 0n },
    blobHashes: [],
    recentRootReferences: [],
  };
}

// ---------------------------------------------------------------- tx gas (contracts/core/SPEC.md §8)

const minimal = (n: bigint): Hex => (n === 0n ? "0x" : toHex(n));
function dataCost(h: Hex | null): { bytes: number; cost: number } {
  if (!h) return { bytes: 0, cost: 0 };
  let cost = 0;
  for (let i = 2; i < h.length; i += 2) cost += h.slice(i, i + 2) === "00" ? 4 : 16;
  return { bytes: (h.length - 2) / 2, cost };
}

/** total_gas_limit as ethrex computes it (SPEC §8); max_cost = this × max_fee_per_gas. */
export function totalGasLimit(tx: FrameTx): bigint {
  const sigCost: Record<number, number> = { 0: 100, 1: 2800, 2: 6700 };
  let mandatory = 12_000 + 475 * tx.frames.length + tx.frames.filter((f) => f.value !== 0n).length * 6_000;
  for (const s of tx.signatures) mandatory += sigCost[s.scheme] ?? 0;
  const fields: (Hex | null)[] = tx.frames.map((f) => f.data);
  for (const s of tx.signatures) fields.push(s.signer, s.msg, s.signature);
  fields.push(concat([toRlp(tx.nonceKeys.map(minimal)), toRlp(minimal(tx.nonceSeq))]));
  if (tx.recentRootReferences.length) fields.push(toRlp(tx.recentRootReferences.map((r) => [r.sourceId, minimal(r.slot), r.root])));
  let bytes = 0;
  let cost = 0;
  for (const f of fields) {
    const d = dataCost(f);
    bytes += d.bytes;
    cost += d.cost;
  }
  const roots = tx.recentRootReferences.length ? 2_400 + 2_002 * tx.recentRootReferences.length : 0;
  const exec = tx.frames.reduce((s, f) => s + f.gasLimit, 0n);
  const state = tx.frames.reduce((s, f) => s + f.stateGasLimit, 0n);
  const standard = BigInt(mandatory + cost + roots) + exec + state;
  const floor = BigInt(mandatory + roots + 64 * bytes) + state;
  return standard > floor ? standard : floor;
}

/** Wei ethrex reserves from the payer for this tx. */
export const maxCostOf = (tx: FrameTx): bigint => totalGasLimit(tx) * tx.fees.maxFeePerGas;
