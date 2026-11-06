// Public actions: deployRule, canTrigger, trigger, simulate, watch. rule-pays rule contracts (mode 0). caller-pays
// rule contracts (Core mode 1): pass { payer } and the trigger is the 3/4-frame layout of ruleContract.ts buildCallerPaysTriggerTx, signed
// by the payer; deployRule({ mode: "callerPays", stake: true }) also runs the rule contract's built-in stake trigger.
// src/popcorn.ts binds them to a viem client (`client.extend(popcorn())`); they are also usable directly with a
// PopcornContext from createPopcornContext().
//
// Truth source: every readiness verdict comes from ethrex_simulateFrameTransaction of the EXACT trigger that trigger() would
// send (same nonce key, limits, fees, data). The nonce key comes from the shadow run in nonceKey.ts.
import { OPEN_SPONSOR_ERRORS } from "./sponsor.ts";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  decodeEventLog,
  defineChain,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  size,
  toHex,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Client,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
} from "viem";
import { sendTransaction, waitForTransactionReceipt } from "viem/actions";
import { CORE_ERRORS, type CoreErrorInfo } from "./artifacts/coreErrors.generated.ts";
import { explain, formatReport, type Report, type SimulateResultLike, type StakeStatus } from "@popcorn/simulator";
import { readStakeStatus } from "./stakeStatus.ts";
import { DEFAULT_CORE, getDeployment, ruleFactoryAbi, type CoreArtifact } from "./deployments.ts";
import { serializeFrameTx, signSecp256k1Entry, txHash as hashOf, type HashSigner } from "./encoder.ts";
import {
  AccountRequired,
  EndpointUnavailable,
  FeeAboveCap,
  InsufficientRuleContractBalance,
  InsufficientPayerBalance,
  PayerRequired,
  RuleContractArgsRejected,
  RuleContractNotReady,
  NotARuleContract,
  NotAdmitted,
  PopcornError,
  RpcError,
} from "./errors.ts";
import {
  checkRuleContractArgsLocal,
  defaultRuleContractArgs,
  encodeRuleContractArgs,
  maxCostOf,
  maxCostPerTrigger,
  parseRuleContractCode,
  triggerCalldata,
  verifyFloor,
  buildTriggerTx,
  buildCallerPaysTriggerTx,
  DEFAULT_PAYER_GAS_LIMIT,
  PUBLIC_PREFIX_BUDGET,
  prefixGasAtCaps,
  type TriggerTail,
  type RuleContractArgs,
  type RuleContractCaps,
  type ParsedRule,
} from "./ruleContract.ts";
import { deriveNonceKey, type RpcFn } from "./nonceKey.ts";
import { NO_OWNER, type OwnerInit } from "./owner.ts";
import {
  devnetChainId,
  getDevnet,
  isGatewayUp,
  publicPrefixBudget,
  rpcRequest,
  sendFrameTransaction,
  simulateFrameTransaction,
  type DevnetConfig,
  type DevnetSelector,
  type SimulationResult,
  type TransportOptions,
  type Via,
} from "./transport.ts";
import { assertValidFrameTx } from "./validate.ts";
import { watch as watchTx, type FinalWatchStatus, type MempoolSource, type WatchOptions } from "./watch.ts";
import type { FrameTx } from "./types.ts";

// ---------------------------------------------------------------- config / context

export interface FeeStrategy {
  /** trigger: maxFeePerGas = min(cap, baseFee × this + tip). Default 2n. */
  baseFeeMultiplier?: bigint;
  /** trigger: tip = min(cap, this). Default: eth_maxPriorityFeePerGas. */
  priorityFee?: bigint;
  /** deployRule: fee cap = 2 × tip cap + baseFee × this. Default 20n. */
  capBaseFeeMultiplier?: bigint;
}

export interface PopcornConfig {
  /** Devnet name or full config (rpc / gateway / local sidecar / explorer). Default "devnet1". */
  devnet?: DevnetSelector;
  /** RuleFactory address. Default: deployments[devnet].factory. */
  factory?: Address;
  /** Core build new rule contracts use. Default: deployments[devnet].core. */
  core?: CoreArtifact;
  /** Where trigger() submits. "auto" (default): the gateway if it answers eth_chainId, else ethrex rpc. */
  via?: Via | "auto";
  fees?: FeeStrategy;
  /** simulate(): ask the sidecar for an admission verdict by SUBMITTING the trigger (eth_sendFrameTransaction); an auto-bundling sidecar (the local devnet's) may then include it. Default false: simulate() predicts the alt-mempool verdict without sending. */
  sidecar?: boolean;
  /** Timeouts, headers, fetch for frame-tx RPC. */
  transport?: Omit<TransportOptions, "devnet">;
}

export interface PopcornContext {
  devnet: DevnetConfig;
  chainId: bigint;
  chain: Chain;
  factory: Address | null;
  core: CoreArtifact;
  via: Via | "auto";
  fees: Required<Pick<FeeStrategy, "baseFeeMultiplier" | "capBaseFeeMultiplier">> & Pick<FeeStrategy, "priorityFee">;
  sidecar: boolean;
  transport: Omit<TransportOptions, "devnet">;
  /** Reads go to the devnet's ethrex node (not the user's transport), so trigger works from any client. */
  publicClient: PublicClient;
  rpc: RpcFn;
  /** The user's client (account + transport for normal txs). */
  client: Client<Transport, Chain | undefined, Account | undefined> | null;
  /** cached gateway health */
  gateway: { up: boolean; at: number } | null;
}

/** A viem chain for a Popcorn devnet (ethrex rpc as the default transport). */
export function devnetChain(devnet: DevnetSelector = "devnet1"): Chain {
  const c = getDevnet(devnet);
  return defineChain({
    id: c.chainId,
    name: `popcorn-${c.name}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [c.rpcUrl] } },
    blockExplorers: { default: { name: "explorer", url: c.explorerUrl } },
  });
}

export function createPopcornContext(config: PopcornConfig = {}, client: PopcornContext["client"] = null): PopcornContext {
  const devnet = getDevnet(config.devnet ?? "devnet1");
  let dep: { factory: Address; core: CoreArtifact } | null = null;
  try {
    dep = getDeployment(devnet.name);
  } catch {
    dep = null;
  }
  const chain = client?.chain ?? devnetChain(devnet);
  const transport = config.transport ?? {};
  return {
    devnet,
    chainId: devnetChainId(devnet),
    chain,
    factory: config.factory ?? dep?.factory ?? null,
    core: config.core ?? dep?.core ?? DEFAULT_CORE,
    via: config.via ?? "auto",
    fees: { baseFeeMultiplier: config.fees?.baseFeeMultiplier ?? 2n, capBaseFeeMultiplier: config.fees?.capBaseFeeMultiplier ?? 20n, priorityFee: config.fees?.priorityFee },
    sidecar: config.sidecar ?? false,
    transport,
    publicClient: createPublicClient({ chain, transport: http(devnet.rpcUrl, { timeout: transport.timeoutMs ?? 60_000 }) }) as PublicClient,
    rpc: <T>(method: string, params: unknown[]) => rpcRequest<T>(devnet.rpcUrl, method, params, { timeoutMs: transport.timeoutMs ?? 60_000, ...(transport.headers ? { headers: transport.headers } : {}), ...(transport.fetch ? { fetch: transport.fetch } : {}) }),
    client,
    gateway: null,
  };
}

const tOpts = (ctx: PopcornContext): TransportOptions => ({ ...ctx.transport, devnet: ctx.devnet });

async function gatewayUp(ctx: PopcornContext): Promise<boolean> {
  if (ctx.gateway && Date.now() - ctx.gateway.at < 60_000) return ctx.gateway.up;
  const up = await isGatewayUp(ctx.devnet, { ...ctx.transport, timeoutMs: 10_000 });
  ctx.gateway = { up, at: Date.now() };
  return up;
}

/** The submit route "auto" resolves to right now. */
export async function resolveVia(ctx: PopcornContext, via: Via | "auto" = ctx.via): Promise<Via> {
  if (via !== "auto") return via;
  return (await gatewayUp(ctx)) ? "gateway" : "rpc";
}

// ---------------------------------------------------------------- fees

async function currentFees(ctx: PopcornContext): Promise<{ baseFee: bigint; suggestedTip: bigint }> {
  const [block, tip] = await Promise.all([ctx.publicClient.getBlock({ blockTag: "latest" }), ctx.rpc<Hex>("eth_maxPriorityFeePerGas", []).catch(() => "0x3b9aca00" as Hex)]);
  return { baseFee: block.baseFeePerGas ?? 0n, suggestedTip: BigInt(tip) };
}

export interface TriggerFees {
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

/** Trigger fees within the rule contract's caps. `enforce`: throw FeeAboveCap for a requested fee above a cap (trigger does; simulate doesn't). */
async function triggerFees(ctx: PopcornContext, args: RuleContractArgs, req: TriggerFees | undefined, enforce: boolean) {
  const { baseFee, suggestedTip } = await currentFees(ctx);
  const min = (a: bigint, b: bigint) => (a < b ? a : b);
  if (args.mode === 1) {
    // caller-pays: Core has no fee caps (the payer pays); the payer's requested fees, else baseFee × multiplier + tip
    let tip = req?.maxPriorityFeePerGas ?? ctx.fees.priorityFee ?? suggestedTip;
    const maxFee = req?.maxFeePerGas ?? baseFee * ctx.fees.baseFeeMultiplier + tip;
    if (req?.maxPriorityFeePerGas === undefined && tip > maxFee) tip = maxFee;
    return { maxFeePerGas: maxFee, maxPriorityFeePerGas: tip, baseFee };
  }
  if (enforce) {
    if (req?.maxFeePerGas !== undefined && req.maxFeePerGas > args.maxFeePerGas) throw new FeeAboveCap("maxFeePerGas", req.maxFeePerGas, args.maxFeePerGas);
    if (req?.maxPriorityFeePerGas !== undefined && req.maxPriorityFeePerGas > args.maxPriorityFeePerGas) throw new FeeAboveCap("maxPriorityFeePerGas", req.maxPriorityFeePerGas, args.maxPriorityFeePerGas);
    if (baseFee > args.maxFeePerGas) throw new FeeAboveCap("baseFee", baseFee, args.maxFeePerGas);
  }
  let tip = req?.maxPriorityFeePerGas ?? min(args.maxPriorityFeePerGas, ctx.fees.priorityFee ?? suggestedTip);
  const maxFee = req?.maxFeePerGas ?? min(args.maxFeePerGas, baseFee * ctx.fees.baseFeeMultiplier + tip);
  if (req?.maxPriorityFeePerGas === undefined && tip > maxFee) tip = maxFee;
  return { maxFeePerGas: maxFee, maxPriorityFeePerGas: tip, baseFee };
}

// ---------------------------------------------------------------- rule contract reads

export interface RuleContractInfo extends ParsedRule {
  address: Address;
  balance: bigint;
  /** factory.maxCostPerTrigger(args): the minimum operating balance. */
  minOperatingBalance: bigint;
}

/** Reads a rule contract: one eth_getCode (args from the code tail, contracts/core/LAYOUT.md) + its balance. */
export async function readRuleContract(ctx: PopcornContext, ruleContract: Address): Promise<RuleContractInfo> {
  const address = getAddress(ruleContract);
  const [code, balance] = await Promise.all([ctx.publicClient.getCode({ address }), ctx.publicClient.getBalance({ address })]);
  const parsed = parseRuleContractCode(code);
  if (!parsed) throw new NotARuleContract(address);
  return { ...parsed, address, balance, minOperatingBalance: maxCostPerTrigger(parsed.args, parsed.core) };
}

// ---------------------------------------------------------------- building + checking a trigger

export interface TriggerOptions {
  /** Bytes the logic decodes (≤ maxTriggerDataLength). Default "0x". */
  triggerData?: Hex;
  /** Frame 0 data handed to __condition (≤ maxVerifyDataLength). Default "0x". */
  verifyData?: Hex;
  /** Override the derived nonce key (a value, or a function of triggerData). */
  nonceKey?: bigint | ((triggerData: Hex) => bigint | Promise<bigint>);
  /** Override the frame 0 execution limit (default max(floor, simulated VERIFY use + margin), ≤ maxGasPerFrame). */
  verifyGasLimit?: bigint;
  fees?: TriggerFees;
  /**
   * Caller-pays rule contracts (mode 1) only, required there: who pays the gas (and receives a CallerPays reward).
   * A local account (EOA payer: signs signatures[1] over the sig hash) or a payer contract's address (no signature;
   * its code must APPROVE payment). Ignored-and-refused for rule-pays rule contracts.
   */
  payer?: HashSigner | Address;
  /** Mode 1: the payer VERIFY frame's execution limit (default 30,000: an EOA's check + the 20,000 nonce first-use). */
  payerGasLimit?: bigint;
  /** Mode 1: an optional DEFAULT frame after the action (frame 3), the payer's own follow-up; never the rule contract. */
  tail?: TriggerTail;
  /** Mode 1, payer contract only: frame 1 data its code reads (e.g. an Open Sponsor membership proof). */
  payerData?: Hex;
}

export interface PreparedTrigger {
  ruleContract: RuleContractInfo;
  triggerData: Hex;
  verifyData: Hex;
  nonceKey: bigint;
  /** Core's VERIFY floor for this trigger's data sizes (check 0x27). */
  floor: bigint;
  verifyGasLimit: bigint;
  /** Frame 0 gas the simulation used (null when the trigger is invalid). */
  verifyGasUsed: bigint | null;
  tx: FrameTx;
  raw: Hex;
  hash: Hex;
  /** Wei ethrex reserves from the payer (rule-pays: the rule contract) for this tx. */
  maxCost: bigint;
  /** Mode 1: the payer's address (null in rule-pays). */
  payer: Address | null;
  simulation: SimulationResult;
  readiness: Readiness;
}

export interface Readiness {
  /** The rule contract accepts this trigger now (ethrex simulate: valid). */
  ready: boolean;
  /** Core revert code (VERIFY), or null for non-Core reasons. */
  code: number | null;
  /** CORE_ERRORS name, or READY / NONCE_USED / INSUFFICIENT_BALANCE / INVALID / ACTION_REVERTS / PAYER_REFUSED (the payer frame said no). */
  name: string;
  reason: string;
  /** Public ethrex's canonical-mempool verdict (e.g. false for reads of another contract's storage). */
  canonical: boolean;
  /** Valid, but the SENDER frame (the action) reverts: the rule contract would pay for nothing. */
  actionReverts: boolean;
}

export const coreErrorOf = (code: number): CoreErrorInfo | null => CORE_ERRORS[code] ?? null;

/** Core code from a 32-byte revert word, else null. */
export const coreCodeOf = (revertData: Hex | null | undefined): number | null => (revertData && size(revertData) === 32 ? Number(BigInt(revertData)) : null);

/** Core code from a sidecar message `validation frame 0: reverted with data 0x…`. */
export function coreCodeFromMessage(msg: string): number | null {
  const m = msg.match(/reverted with data (0x[0-9a-fA-F]{64})\b/);
  return m ? Number(BigInt(m[1]!)) : null;
}

export function readinessOf(sim: SimulationResult): Readiness {
  const canonical = sim.canonicalMempoolValid;
  if (sim.executionStatus !== null) {
    const actionReverts = sim.executionStatus === "reverted";
    return { ready: true, code: null, name: actionReverts ? "ACTION_REVERTS" : "READY", reason: actionReverts ? "valid, but the SENDER frame (action) reverts" : "valid", canonical, actionReverts };
  }
  const code = coreCodeOf(sim.revertData);
  // A refusal from the payer's frame (caller-pays frame 1) is the payer's own code, not Core's: name it as such.
  if (code !== null && sim.failedFrameIndex === 1) {
    const sponsorReason = OPEN_SPONSOR_ERRORS[code];
    return { ready: false, code, name: "PAYER_REFUSED", reason: sponsorReason ? `payer refused: ${sponsorReason} (0x${code.toString(16)})` : `payer refused with 0x${code.toString(16)}`, canonical, actionReverts: false };
  }
  if (code !== null) {
    const e = coreErrorOf(code);
    return { ready: false, code, name: e?.name ?? "UNKNOWN_CORE_CODE", reason: e?.check ?? `Core revert 0x${code.toString(16)}`, canonical, actionReverts: false };
  }
  const err = sim.executionError ?? sim.canonicalMempoolViolation ?? "invalid";
  const name = /nonce/i.test(err) ? "NONCE_USED" : /insufficient|funds|balance/i.test(err) ? "INSUFFICIENT_BALANCE" : "INVALID";
  return { ready: false, code: null, name, reason: err, canonical, actionReverts: false };
}

/** Public 100k cap on the declared VERIFY limit: the first simulation probes at most this much. */
const PROBE_VERIFY_GAS = 100_000n;
const margin = (used: bigint) => (used / 10n > 2_000n ? used / 10n : 2_000n);

/**
 * Builds the exact trigger and simulates it on ethrex (twice when the VERIFY limit is derived: probe, then
 * max(floor, used + max(2,000, 10%)) capped at maxGasPerFrame). Never sends anything.
 */
export async function prepareTrigger(ctx: PopcornContext, ruleContractAddr: Address, o: TriggerOptions = {}, enforceCaps = true): Promise<PreparedTrigger> {
  const ruleContract = await readRuleContract(ctx, ruleContractAddr);
  const a = ruleContract.args;
  const sp = a.mode === 1;
  if (sp && o.payer === undefined) throw new PayerRequired(ruleContract.address);
  if (!sp && (o.payer !== undefined || o.tail !== undefined)) throw new PopcornError(`rule contract ${ruleContract.address} is rule-pays (mode 0): it pays its own triggers; payer/tail apply to caller-pays rule contracts only`);
  const payerAddr: Address | null = o.payer === undefined ? null : getAddress(typeof o.payer === "string" ? o.payer : o.payer.address);
  const payerSigner: HashSigner | null = o.payer !== undefined && typeof o.payer !== "string" ? o.payer : null;
  if (payerAddr && !payerSigner) {
    // an address means a payer CONTRACT (no signature); an EOA must be passed as an account that signs
    const code = await ctx.publicClient.getCode({ address: payerAddr });
    if (!code || code === "0x") throw new PopcornError(`payer ${payerAddr} has no code: an EOA payer must be passed as an account that signs (e.g. privateKeyToAccount), not as an address`);
  }
  const triggerData = o.triggerData ?? "0x";
  const verifyData = o.verifyData ?? "0x";
  const nonceKey =
    o.nonceKey === undefined
      ? await deriveNonceKey(ctx.rpc, ruleContract.address, a.logic, triggerData, ruleContract.core.constants.nonceKeyGas)
      : typeof o.nonceKey === "bigint"
        ? o.nonceKey
        : await o.nonceKey(triggerData);
  const fees = await triggerFees(ctx, a, o.fees, enforceCaps);
  const floor = verifyFloor(a, size(verifyData), size(triggerCalldata(triggerData, ruleContract.core)), ruleContract.core);
  const cap = a.maxGasPerFrame;
  const clamp = (g: bigint) => (g > cap ? cap : g);
  const build = async (verifyGasLimit: bigint) => {
    const base = { ruleContract: ruleContract.address, args: a, chainId: ctx.chainId, triggerData, verifyData, nonceKey, verifyGasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, core: ruleContract.core };
    let tx = sp
      ? buildCallerPaysTriggerTx({ ...base, payer: payerAddr!, payerGasLimit: o.payerGasLimit ?? DEFAULT_PAYER_GAS_LIMIT, payerKind: payerSigner ? "eoa" : "contract", ...(o.tail ? { tail: o.tail } : {}), ...(o.payerData ? { payerData: o.payerData } : {}) })
      : buildTriggerTx(base);
    if (sp && payerSigner) tx = await signSecp256k1Entry(tx, 1, payerSigner); // the payer signs the whole tx last
    const raw = serializeFrameTx(tx);
    return { tx, raw };
  };
  const sim = (raw: Hex) => simulateFrameTransaction(raw, { ...tOpts(ctx), trace: false });

  let limit = o.verifyGasLimit ?? clamp(floor > PROBE_VERIFY_GAS ? floor : PROBE_VERIFY_GAS);
  let { tx, raw } = await build(limit);
  let s = await sim(raw);
  if (o.verifyGasLimit === undefined) {
    // starved at the probe (condition / nonce key call failed, or out of gas): retry at the cap
    const c = coreCodeOf(s.revertData);
    if (s.executionStatus === null && limit < cap && (c === 0x20 || c === 0x1b || /gas/i.test(s.executionError ?? ""))) {
      limit = cap;
      ({ tx, raw } = await build(limit));
      s = await sim(raw);
    }
    const used = s.executionStatus !== null ? (s.frames?.[0]?.gasUsed ?? null) : null;
    if (used !== null) {
      const want = clamp(used + margin(used) > floor ? used + margin(used) : floor);
      if (want !== limit) {
        limit = want;
        ({ tx, raw } = await build(limit));
        s = await sim(raw);
      }
    }
  }
  return {
    ruleContract,
    triggerData,
    verifyData,
    nonceKey,
    floor,
    verifyGasLimit: limit,
    verifyGasUsed: s.executionStatus !== null ? (s.frames?.[0]?.gasUsed ?? null) : null,
    tx,
    raw,
    hash: hashOf(raw),
    maxCost: maxCostOf(tx),
    payer: payerAddr,
    simulation: s,
    readiness: readinessOf(s),
  };
}

// ---------------------------------------------------------------- canTrigger

export interface CanTriggerResult extends Readiness {
  nonceKey: bigint;
  verifyGasLimit: bigint;
  simulation: SimulationResult;
  tx: FrameTx;
}

/**
 * Would the rule contract accept a trigger with these triggerData / verifyData right now? Builds the exact trigger trigger() would send and
 * simulates it on ethrex (Core's real VERIFY: nonce key, condition, caps, floor, balance). Sends nothing.
 */
export async function canTrigger(ctx: PopcornContext, ruleContract: Address, o: TriggerOptions = {}): Promise<CanTriggerResult> {
  const p = await prepareTrigger(ctx, ruleContract, o, false);
  return { ...p.readiness, nonceKey: p.nonceKey, verifyGasLimit: p.verifyGasLimit, simulation: p.simulation, tx: p.tx };
}

// ---------------------------------------------------------------- trigger

export interface TriggerSendOptions extends TriggerOptions {
  /** Submit route; default the context's (auto: gateway if healthy, else rpc). */
  via?: Via | "auto";
  /** Send even if the simulated action reverts (the rule contract pays for a no-op). Default false. */
  allowActionRevert?: boolean;
}

export interface TriggerResult {
  hash: Hex;
  via: Via;
  prepared: PreparedTrigger;
}

/** trigger() with details (the prepared tx, route). */
export async function triggerDetailed(ctx: PopcornContext, ruleContract: Address, o: TriggerSendOptions = {}): Promise<TriggerResult> {
  const p = await prepareTrigger(ctx, ruleContract, o, true);
  const r = p.readiness;
  const payerBalance = p.payer ? await ctx.publicClient.getBalance({ address: p.payer }) : null;
  if (p.payer) {
    if (payerBalance! < p.maxCost) throw new InsufficientPayerBalance(p.payer, payerBalance!, p.maxCost);
  } else if (p.ruleContract.balance < p.maxCost) throw new InsufficientRuleContractBalance(p.ruleContract.address, p.ruleContract.balance, p.maxCost, "thisTrigger");
  if (!r.ready) {
    if (r.name === "INSUFFICIENT_BALANCE") {
      if (p.payer) throw new InsufficientPayerBalance(p.payer, payerBalance!, p.maxCost);
      throw new InsufficientRuleContractBalance(p.ruleContract.address, p.ruleContract.balance, p.maxCost, "thisTrigger");
    }
    throw new RuleContractNotReady(p.ruleContract.address, r.code, r.name, r.reason);
  }
  if (r.actionReverts && !o.allowActionRevert) throw new RuleContractNotReady(p.ruleContract.address, null, "ACTION_REVERTS", r.reason);
  assertValidFrameTx(p.tx);
  const via = await resolveVia(ctx, o.via);
  try {
    const hash = await sendFrameTransaction(p.raw, { ...tOpts(ctx), via });
    return { hash, via, prepared: p };
  } catch (e) {
    if (e instanceof RpcError) throw new NotAdmitted(via, `[${e.code}] ${e.rpcMessage}`, { cause: e });
    if (e instanceof EndpointUnavailable) throw new NotAdmitted(via, e.message, { cause: e });
    throw e;
  }
}

/**
 * Triggers a rule contract: reads its args from its code, derives the nonce key, builds the trigger, checks it on ethrex (throws
 * RuleContractNotReady without sending), submits it and returns the hash.
 * Rule-pays (mode 0): the 2-frame tx; needs no account and no ETH.
 * Caller-pays (mode 1): pass { payer } (and optionally { tail }); the 3/4-frame tx, signed and paid by the payer.
 */
export async function trigger(ctx: PopcornContext, ruleContract: Address, o: TriggerSendOptions = {}): Promise<Hex> {
  return (await triggerDetailed(ctx, ruleContract, o)).hash;
}

// ---------------------------------------------------------------- simulate

/** The verdict data is defined once, in @popcorn/simulator (SimulateResultLike); this narrows it to the SDK's types. */
export interface SimulateResult extends SimulateResultLike {
  hash: Hex;
  raw: Hex;
  tx: FrameTx;
  nonceKey: bigint;
  verifyGasLimit: bigint;
  floor: bigint;
  ethrex: {
    valid: boolean;
    executionStatus: SimulationResult["executionStatus"];
    canonicalMempoolValid: boolean;
    canonicalMempoolViolation: string | null;
    error: string | null;
    revertData: Hex | null;
    verifyGas: bigint | null;
    gasUsed: bigint | null;
    maxCost: bigint | null;
  };
  /** Local sidecar verdict (null when disabled or unreachable; see `sidecarError`). */
  sidecar: { admitted: boolean; code: number | null; message: string } | null;
  sidecarError?: string;
  /** Core revert code from ethrex (or the sidecar message) with its CORE_ERRORS name. */
  coreError?: { code: number; name: string; check: string };
  ruleContractBalance: bigint;
  /** factory.maxCostPerTrigger of the rule contract's args. */
  minOperatingBalance: bigint;
  /** Wei ethrex reserves for this tx (from the payer in mode 1). */
  maxCost: bigint;
  /** Mode 1: the payer (null in rule-pays). */
  payer: Address | null;
  /** Mode 1: the payer's balance (null in rule-pays). */
  payerBalance: bigint | null;
  /** Prefix gas of this trigger as the budgets count it (declared VERIFY limits + signature cost). */
  prefixGas: bigint;
  /** Set when prefixGas is over the devnet's ethrex cap (`devnet.budgets.ethrex`: 100,000 on devnet1, 250,000 locally): its mempool refuses it. */
  warning?: string;
  /** "local" for the local devnet, else "devnet1": which public VERIFY budget the verdicts use (250k / 100k). */
  network: "devnet1" | "local";
  /** The rule contract's stake in the devnet's staking registry (null when the registry could not be read). */
  stake: StakeStatus | null;
  /** The plain-English two-mempool report (@popcorn/simulator explain()). */
  report: Report;
  /** formatReport(report): the text the CLI prints. */
  text: string;
}

export interface SimulateOptions extends TriggerOptions {
  /**
   * Opt in to the sidecar's own admission check. DEFAULT false. It SUBMITS the exact trigger (eth_sendFrameTransaction;
   * the sidecar has no read-only validate: eth_estimateFrameTransactionGas always fails with Core 0x15), and a sidecar
   * that auto-bundles (the local devnet's) may INCLUDE it for real. Without it the alt-mempool verdict is predicted
   * from ethrex, the stake status and the budgets.
   */
  sidecar?: boolean;
  /**
   * NOT SUPPORTED. Simulating "as of" a future time would need a recent-root reference, and Core rejects those
   * (code 0x23). Passing it throws SimulateAtUnsupported.
   */
  at?: unknown;
}

/**
 * Builds the same tx as trigger() (fees are NOT clamped to the caps, so an over-cap trigger shows Core 0x12) and returns the
 * raw verdicts (ethrex simulate, the rule contract's stake, balances; the sidecar's admission only with `sidecar: true`, which submits the trigger) plus `report` and `text`:
 * what the public mempool and the alt mempool would each say, in plain English, with a fix per problem.
 */
export async function simulate(ctx: PopcornContext, ruleContract: Address, o: SimulateOptions = {}): Promise<SimulateResult> {
  if (o.at !== undefined) throw new PopcornError("simulate({ at }) is not supported: Core rejects recent-root references (code 0x23), so a trigger cannot be simulated as of another time. Simulate now, or change the state the condition reads.");
  const p = await prepareTrigger(ctx, ruleContract, o, false);
  const s = p.simulation;
  const network: "devnet1" | "local" = ctx.devnet.name === "local" ? "local" : "devnet1";
  const out: Omit<SimulateResult, "report" | "text"> = {
    hash: p.hash,
    raw: p.raw,
    tx: p.tx,
    nonceKey: p.nonceKey,
    verifyGasLimit: p.verifyGasLimit,
    floor: p.floor,
    ethrex: {
      valid: s.executionStatus !== null,
      executionStatus: s.executionStatus,
      canonicalMempoolValid: s.canonicalMempoolValid,
      canonicalMempoolViolation: s.canonicalMempoolViolation,
      error: s.executionError,
      revertData: s.revertData,
      verifyGas: p.verifyGasUsed,
      gasUsed: s.gasUsed,
      maxCost: s.maxCost,
    },
    sidecar: null,
    ruleContractBalance: p.ruleContract.balance,
    minOperatingBalance: p.ruleContract.minOperatingBalance,
    maxCost: p.maxCost,
    payer: p.payer,
    payerBalance: p.payer ? await ctx.publicClient.getBalance({ address: p.payer }) : null,
    prefixGas: prefixGasOf(p.tx),
    network,
    stake: await readStakeStatus(ctx.publicClient, ctx.devnet.name, p.ruleContract.address),
  };
  const cap = BigInt(publicPrefixBudget(ctx.devnet));
  if (out.prefixGas > cap) out.warning = cap === PUBLIC_PREFIX_BUDGET ? `prefix gas ${out.prefixGas} > ${cap}: public ethrex and the upstream sidecar refuse it (local / patched sidecars allow 250,000 unstaked)` : `prefix gas ${out.prefixGas} > ${cap}: ${ctx.devnet.name}'s ethrex refuses it (its --mempool.max-verify-gas)`;
  if (o.sidecar ?? ctx.sidecar) {
    try {
      await sendFrameTransaction(p.raw, { ...tOpts(ctx), via: "sidecar", timeoutMs: ctx.transport.timeoutMs ?? 30_000 });
      out.sidecar = { admitted: true, code: null, message: "admitted" };
    } catch (e) {
      if (e instanceof RpcError) out.sidecar = { admitted: false, code: e.code, message: e.rpcMessage };
      else out.sidecarError = e instanceof Error ? e.message : String(e);
    }
  }
  const code = coreCodeOf(s.revertData) ?? (out.sidecar && !out.sidecar.admitted ? coreCodeFromMessage(out.sidecar.message) : null);
  if (code !== null) {
    const e = coreErrorOf(code);
    out.coreError = { code, name: e?.name ?? "UNKNOWN_CORE_CODE", check: e?.check ?? "" };
  }
  const report = explain(out, { network });
  const asked = out.sidecar !== null || out.sidecarError !== undefined;
  const text = formatReport(report) + (asked ? "\nnote  The sidecar admission check SUBMITTED this trigger; an auto-bundling sidecar (the local devnet's) may include it for real." : "");
  return { ...out, report, text };
}

// ---------------------------------------------------------------- watch

/** watch() with the context's devnet; mempools default to the gateway when it is up, else none (node only). */
export async function watch(ctx: PopcornContext, hash: Hex, o: WatchOptions = {}): Promise<FinalWatchStatus> {
  const mempools: MempoolSource[] = o.mempools ?? ((await gatewayUp(ctx)) ? ["gateway"] : []);
  return watchTx(hash, { ...o, devnet: ctx.devnet, mempools, ...(ctx.transport.fetch ? { fetch: ctx.transport.fetch } : {}), ...(ctx.transport.headers ? { headers: ctx.transport.headers } : {}) });
}

// ---------------------------------------------------------------- deployRule

export interface LogicSpec {
  abi?: Abi | readonly unknown[];
  bytecode: Hex;
  /** constructor args */
  args?: readonly unknown[];
}

export interface DeployRuleOptions {
  /** A deployed logic contract, or its artifact to deploy first (normal tx from the client's account). */
  logic: Address | LogicSpec;
  /** Overrides of the default caps (ruleContract.ts defaultRuleContractArgs). */
  caps?: RuleContractCaps;
  /** Wei sent with factory.create (the rule contract's balance). Must be ≥ factory.maxCostPerTrigger unless allowUnderfunded. */
  fund?: bigint;
  /** CREATE2 salt. Default: random. */
  salt?: Hex;
  /** Don't throw when fund < the minimum operating balance (e.g. funding later with a plain transfer). */
  allowUnderfunded?: boolean;
  /** Gas for the logic deploy (default 24,000,000: a rule contract logic with the owner and stake base contracts is 8-11 KB, and code deposit costs ~1.5k gas per byte here; unused gas is refunded) and factory.create (default 14,000,000): set explicitly because
   *  ethrex eth_estimateGas wants balance ≥ block gas limit × fee. */
  gas?: { logic?: bigint; create?: bigint };
  /** "rulePays" (default, Core mode 0) or "callerPays" (Core mode 1: every trigger has a separate payer; the fee caps
   *  are 0 and the rule contract needs no gas balance). Must match the logic's popcornMode() if it declares one. */
  mode?: "rulePays" | "callerPays";
  /**
   * Run the rule contract's built-in stake trigger right after deploying (RuleStake): the logic's
   * popcornStakeConfig() amount must be > 0, and `fund` must cover it (+ the minimum operating balance in rule-pays).
   * Rule-pays: the rule contract pays the stake trigger. Caller-pays: the client's account pays it as the payer (a local
   * account: it signs its VERIFY frame). Waits for inclusion and reads the registry. Default false.
   */
  stake?: boolean;
  /**
   * the rule contract's hybrid owner (`hybridSigner(...).ownerInit()`): ECDSA address + WOTS+ root + public seed, written
   * by Core's constructor. Omit for a rule contract without an owner (its owner path is off). Needs a Core factory.
   */
  owner?: OwnerInit;
}

export interface StakeResult {
  /** The stake trigger's tx hash. */
  txHash: Hex;
  registry: Address;
  amount: bigint;
  /** registry.getDepositInfo(rule contract).stake after the trigger. */
  stakeAfter: bigint;
  staked: boolean;
}

export interface DeployRuleResult {
  ruleContract: Address;
  logic: Address;
  args: RuleContractArgs;
  argsHex: Hex;
  salt: Hex;
  txHash: Hex;
  logicTxHash: Hex | null;
  fund: bigint;
  minOperatingBalance: bigint;
  receipt: TransactionReceipt;
  /** Present when deployRule ran the stake trigger. */
  stake?: StakeResult;
  /** e.g. the rule contract's smallest trigger exceeds the public 100k prefix budget (factory.prefixGasAtCaps). */
  warnings: string[];
}

/** Prefix gas of a tx as the mempool budgets count it: declared limits of the leading VERIFY frames + signature cost. */
export function prefixGasOf(tx: FrameTx): bigint {
  const sigCost: Record<number, bigint> = { 0: 100n, 1: 2_800n, 2: 6_700n };
  let g = 0n;
  for (const f of tx.frames) {
    if (f.mode !== 1) break;
    g += f.gasLimit;
  }
  for (const s of tx.signatures) g += sigCost[s.scheme] ?? 0n;
  return g;
}

const STAKE_ABI = [
  { type: "function", name: "popcornStakeConfig", stateMutability: "view", inputs: [], outputs: [{ type: "address" }, { type: "uint256" }, { type: "uint32" }] },
  { type: "function", name: "STAKE_TRIGGER_DATA", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "getDepositInfo", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }, { type: "uint32" }, { type: "uint64" }] },
] as const;

/** triggerData of the built-in stake trigger: keccak256("popcorn.stake.trigger") (RuleStake.STAKE_TRIGGER_DATA). */
export const STAKE_TRIGGER_DATA: Hex = "0x9dd788feded4e6aa42613b012c5b0c4fc54b7a00cd0610258a6f60f98bee4894";

/** The logic's stake config (registry, amount, delay), or null if it has none. */
export async function readStakeConfig(ctx: PopcornContext, logic: Address): Promise<{ registry: Address; amount: bigint; delay: number } | null> {
  try {
    const [registry, amount, delay] = await ctx.publicClient.readContract({ address: logic, abi: STAKE_ABI, functionName: "popcornStakeConfig" });
    return { registry, amount, delay };
  } catch {
    return null;
  }
}

/** registry.getDepositInfo(rule contract).stake (0 if the registry has no code / reverts). */
export async function readStake(ctx: PopcornContext, registry: Address, ruleContract: Address): Promise<bigint> {
  try {
    const [stake] = await ctx.publicClient.readContract({ address: registry, abi: STAKE_ABI, functionName: "getDepositInfo", args: [ruleContract] });
    return stake;
  } catch {
    return 0n;
  }
}

/**
 * Runs a rule contract's built-in stake trigger (triggerData = STAKE_TRIGGER_DATA) and waits for it. Rule-pays: no payer. Caller-pays:
 * `payer` pays. Returns the registry's stake for the rule contract afterwards.
 */
export async function stakeRule(ctx: PopcornContext, ruleContract: Address, o: { payer?: HashSigner; via?: Via | "auto"; timeoutMs?: number } = {}): Promise<StakeResult> {
  const info = await readRuleContract(ctx, ruleContract);
  const cfg = await readStakeConfig(ctx, info.args.logic);
  if (!cfg || cfg.amount === 0n) throw new PopcornError(`rule contract ${ruleContract}: the logic has no stake config (popcornStakeConfig amount 0)`);
  const r = await triggerDetailed(ctx, ruleContract, { triggerData: STAKE_TRIGGER_DATA, ...(o.payer ? { payer: o.payer } : {}), ...(o.via ? { via: o.via } : {}) });
  const st = await watch(ctx, r.hash, { timeoutMs: o.timeoutMs ?? 180_000 });
  if (st.state !== "included") throw new PopcornError(`stake trigger ${r.hash}: ${st.state}`);
  const stakeAfter = await readStake(ctx, cfg.registry, info.address);
  return { txHash: r.hash, registry: cfg.registry, amount: cfg.amount, stakeAfter, staked: stakeAfter >= cfg.amount };
}

function requireAccount(ctx: PopcornContext) {
  const c = ctx.client;
  if (!c?.account) throw new AccountRequired("deployRule needs a client with an account (createWalletClient({ account, ... }))");
  return { client: c as Client<Transport, Chain | undefined, Account>, account: c.account };
}

function revertName(e: unknown): { name: string; detail: string } {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return { name: r.data?.errorName ?? r.reason ?? "reverted", detail: (r.data?.args ?? []).map(String).join(", ") };
    return { name: "reverted", detail: e.shortMessage };
  }
  return { name: "reverted", detail: String(e) };
}

/**
 * Deploys a rule contract through RuleFactory: deploys the logic if bytecode is given, computes args (defaults from the
 * current fees + caps), checks them locally and with factory.checkArgs (eth_call), refuses fund < maxCostPerTrigger,
 * calls factory.create{value: fund}, waits, and checks the deployed code is Core runtime ++ args.
 */
export async function deployRule(ctx: PopcornContext, o: DeployRuleOptions): Promise<DeployRuleResult> {
  const { client, account } = requireAccount(ctx);
  if (!ctx.factory) throw new PopcornError(`no factory for ${ctx.devnet.name}: pass popcorn({ factory })`);
  const factory = ctx.factory;
  const pub = ctx.publicClient;
  const chain = client.chain ?? ctx.chain;

  // 1. logic
  let logic: Address;
  let logicTxHash: Hex | null = null;
  if (typeof o.logic === "string") {
    logic = getAddress(o.logic);
  } else {
    const data = o.logic.abi && o.logic.args?.length ? encodeDeployData({ abi: o.logic.abi as Abi, bytecode: o.logic.bytecode, args: o.logic.args as unknown[] }) : o.logic.bytecode;
    logicTxHash = await sendTransaction(client, { account, chain, data, gas: o.gas?.logic ?? 24_000_000n } as Parameters<typeof sendTransaction>[1]);
    const r = await waitForTransactionReceipt(pub, { hash: logicTxHash, timeout: 180_000 });
    if (r.status !== "success" || !r.contractAddress) throw new PopcornError(`logic deploy failed: ${logicTxHash}`);
    logic = getAddress(r.contractAddress);
  }

  // 2. args
  const { baseFee, suggestedTip } = await currentFees(ctx);
  const mode = o.mode === "callerPays" ? 1 : 0;
  const args = defaultRuleContractArgs({ logic, baseFee, suggestedTip, baseFeeMultiplier: ctx.fees.capBaseFeeMultiplier, ...(o.caps ? { caps: o.caps } : {}), core: ctx.core, mode });
  const local = checkRuleContractArgsLocal(args, ctx.core);
  if (local) throw new RuleContractArgsRejected(local, "local mirror of RuleFactory.checkArgs");
  try {
    await pub.readContract({ address: factory, abi: ruleFactoryAbi, functionName: "checkArgs", args: [args] });
  } catch (e) {
    const r = revertName(e);
    throw new RuleContractArgsRejected(r.name, r.detail);
  }
  const minOperatingBalance = await pub.readContract({ address: factory, abi: ruleFactoryAbi, functionName: "maxCostPerTrigger", args: [args] });
  const fund = o.fund ?? 0n;
  const stakeCfg = o.stake ? await readStakeConfig(ctx, logic) : null;
  if (o.stake && (!stakeCfg || stakeCfg.amount === 0n)) throw new PopcornError(`stake: logic ${logic} has no stake config (popcornStakeConfig amount 0)`);
  const needed = minOperatingBalance + (stakeCfg?.amount ?? 0n);
  if (fund < needed && !o.allowUnderfunded) throw new InsufficientRuleContractBalance("(not deployed)", fund, needed, "maxCostPerTrigger");
  const stakePayer = o.stake && mode === 1 ? (account as unknown as Partial<HashSigner>) : null;
  if (stakePayer && typeof stakePayer.sign !== "function") throw new AccountRequired("deployRule({ mode: \"callerPays\", stake }) needs a local account (it signs the stake trigger as its payer)");

  // 3. create
  const salt = o.salt ?? keccak256(toHex(`${logic}:${Date.now()}:${Math.random()}`));
  const owner = o.owner ?? NO_OWNER;
  const predicted = await pub.readContract({ address: factory, abi: ruleFactoryAbi, functionName: "predict", args: [args, owner, salt] });
  const txHash = await sendTransaction(client, {
    account,
    chain,
    to: factory,
    value: fund,
    data: encodeFunctionData({ abi: ruleFactoryAbi, functionName: "create", args: [args, owner, salt] }),
    gas: o.gas?.create ?? 14_000_000n, // Core (5.6 KB) deposit at ~1.2k gas/byte + 63/64 of CREATE2 + 3 owner slots of state gas
  } as Parameters<typeof sendTransaction>[1]);
  const receipt = await waitForTransactionReceipt(pub, { hash: txHash, timeout: 180_000 });
  if (receipt.status !== "success") throw new PopcornError(`factory.create reverted: ${txHash}`);
  let ruleContract: Address | null = null;
  for (const l of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: ruleFactoryAbi, data: l.data, topics: l.topics });
      if (ev.eventName === "RuleContractCreated") ruleContract = getAddress((ev.args as { ruleContract: Address }).ruleContract);
    } catch {
      /* other event */
    }
  }
  if (!ruleContract) throw new PopcornError(`factory.create ${txHash}: no RuleContractCreated event`);
  if (ruleContract !== getAddress(predicted)) throw new PopcornError(`rule contract ${ruleContract} != predicted ${predicted}`);
  const parsed = parseRuleContractCode(await pub.getCode({ address: ruleContract }));
  const argsHex = encodeRuleContractArgs(args);
  if (!parsed || parsed.argsHex !== argsHex.toLowerCase()) throw new NotARuleContract(ruleContract);
  const warnings: string[] = [];
  const pg = prefixGasAtCaps(args, ctx.core);
  const pcap = BigInt(publicPrefixBudget(ctx.devnet));
  if (pg > pcap) warnings.push(pcap === PUBLIC_PREFIX_BUDGET ? `prefixGasAtCaps ${pg} > ${pcap}: triggers at the data caps cannot use public ethrex / the upstream sidecar (local / patched sidecars: 250k unstaked, 2.5M staked)` : `prefixGasAtCaps ${pg} > ${pcap}: triggers at the data caps cannot use ${ctx.devnet.name}'s ethrex mempool (its --mempool.max-verify-gas)`);
  const out: DeployRuleResult = { ruleContract, logic, args, argsHex, salt, txHash, logicTxHash, fund, minOperatingBalance, receipt, warnings };
  if (o.stake) out.stake = await stakeRule(ctx, ruleContract, stakePayer ? { payer: stakePayer as HashSigner } : {});
  return out;
}
