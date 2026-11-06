// Client unit tests (offline): the trigger that trigger() builds vs the reference builder (test/reference.ts), byte for
// byte; args parsing from the code tail; default caps vs the factory bounds (mirror); Core error table; readiness.
import { concat, createPublicClient, encodeAbiParameters, getAddress, http, keccak256, size, toHex, type Address, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
// The independent reference: a LAYOUT.md-driven args encoder and a trigger builder written from first principles.
import { buildTrigger, coreArgs, decodeArgs, DEFAULT_ARGS, layout, type RefRule } from "./reference.ts";
import {
  CORE_BUILDS,
  CORE_ERRORS,
  CORE,
  DEFAULT_CORE,
  FACTORY_CORE_CREATION_CODE_HASH,
  FACTORY_BOUNDS,
  FrameFlags,
  FrameMode,
  InsufficientRuleContractBalance,
  RuleContractNotReady,
  FeeAboveCap,
  buildTriggerTx,
  checkRuleContractArgsLocal,
  decodeRuleContractArgs,
  defaultRuleContractArgs,
  devnetChain,
  devnets,
  encodeRuleContractArgs,
  maxCostPerTrigger,
  parseFrameTx,
  parseRuleContractCode,
  triggerCalldata,
  popcorn,
  readinessOf,
  serializeFrameTx,
  shadowInitcode,
  txHash,
  validateFrameTx,
  verifyFloor,
  verifyFloorAtCaps,
  type RuleContractArgs,
  type SimulationResult,
} from "../src/index.ts";
import { prng as rand } from "./random.ts";

const ROOT = new URL("../../../", import.meta.url).pathname;
const LOGIC: Address = getAddress("0x0d6bf6091229b01222040c33ba97edc78bfcdd95");
const RULE_CONTRACT: Address = getAddress("0xb00bf269f74cd4ab3c9ae8b013501ca4e97f0dd3");

const randomArgs = (r: () => number): RuleContractArgs => ({
  logic: getAddress(toHex(BigInt(Math.floor(r() * 2 ** 48)) + 1n, { size: 20 })),
  mode: 0,
  maxFeePerGas: BigInt(1 + Math.floor(r() * 1e12)),
  maxPriorityFeePerGas: BigInt(Math.floor(r() * 1e9)),
  maxGasPerFrame: BigInt(40_000 + Math.floor(r() * 2_000_000)),
  maxStateGasPerFrame: BigInt(Math.floor(r() * 6) * 97_920),
  verifier: r() < 0.5 ? "0x0000000000000000000000000000000000000000" : getAddress(toHex(BigInt(Math.floor(r() * 2 ** 40)) + 7n, { size: 20 })),
  conditionGas: 5_000 + Math.floor(r() * 300_000),
  maxVerifyDataLength: Math.floor(r() * 8_192),
  maxTriggerDataLength: Math.floor(r() * 4_096),
});

const refRule = (args: Hex, key: bigint): RefRule => ({
  address: RULE_CONTRACT,
  values: decodeArgs(layout, args),
  keyOf: async () => key,
});

describe("rule contract args (101 bytes, contracts/core/LAYOUT.md)", () => {
  it("encodeRuleContractArgs == the reference LAYOUT.md-driven encoder, and decode round-trips (200 random)", () => {
    const r = rand(41);
    for (let i = 0; i < 200; i++) {
      const a = randomArgs(r);
      const ours = encodeRuleContractArgs(a);
      const { logic, mode, ...caps } = a;
      const theirs = coreArgs(logic, mode, { ...caps, conditionGas: BigInt(caps.conditionGas), maxVerifyDataLength: BigInt(caps.maxVerifyDataLength), maxTriggerDataLength: BigInt(caps.maxTriggerDataLength) } as never);
      expect(ours).toBe(theirs);
      expect(size(ours)).toBe(101);
      expect(decodeRuleContractArgs(ours)).toEqual(a);
    }
  });

  it("parseRuleContractCode: runtime ++ args → args; anything else → null", () => {
    const a = randomArgs(rand(7));
    const code = concat([CORE.runtime, encodeRuleContractArgs(a)]);
    const p = parseRuleContractCode(code)!;
    expect(p.args).toEqual(a);
    expect(p.core).toBe(CORE);
    expect(p.argsHex).toBe(encodeRuleContractArgs(a).toLowerCase());
    expect(parseRuleContractCode(code.toUpperCase().replace("0X", "0x") as Hex)?.args).toEqual(a); // case-insensitive
    expect(parseRuleContractCode(concat([code, "0x00"]))).toBeNull(); // trailing byte
    expect(parseRuleContractCode(code.slice(0, -2) as Hex)).toBeNull(); // 100-byte tail
    expect(parseRuleContractCode(concat(["0xfe", code.slice(4) as Hex]))).toBeNull(); // different runtime
    expect(parseRuleContractCode("0x")).toBeNull();
    expect(parseRuleContractCode(undefined)).toBeNull();
    expect(CORE_BUILDS).toContain(CORE);
  });

  it("Core is the default build, pinned by the factory, and its error table is complete", () => {
    const a = randomArgs(rand(11));
    expect(DEFAULT_CORE).toBe(CORE);
    expect(CORE.creationHash).toBe(FACTORY_CORE_CREATION_CODE_HASH);
    expect(parseRuleContractCode(concat([CORE.runtime, encodeRuleContractArgs(a)]))!.core).toBe(CORE);
    expect(CORE_ERRORS[0x38]!.name).toBe("FORWARD_RESERVED_SELECTOR");
    expect(CORE_ERRORS[0x39]!.section).toBe("FORWARD");
    expect(CORE_ERRORS[0x3b]!.name).toBe("SENDER_NOT_OWN_POP");
    expect(CORE_ERRORS[0x3b]!.section).toBe("SENDER");
  });

  it("defaultRuleContractArgs satisfies the factory bounds for any fee level and caps that allow it (1,000 random)", () => {
    const r = rand(99);
    for (let i = 0; i < 1000; i++) {
      const caps: Record<string, unknown> = {};
      if (r() < 0.5) caps.conditionGas = 5_000 + Math.floor(r() * 500_000);
      if (r() < 0.5) caps.maxVerifyDataLength = Math.floor(r() * 8_192);
      if (r() < 0.5) caps.maxTriggerDataLength = Math.floor(r() * 4_096);
      if (r() < 0.3) caps.maxStateGasPerFrame = BigInt(Math.floor(r() * 64)) * 97_920n;
      const a = defaultRuleContractArgs({ logic: LOGIC, baseFee: BigInt(Math.floor(r() * 1e11)), suggestedTip: BigInt(Math.floor(r() * 1e10)), caps });
      expect(checkRuleContractArgsLocal(a), JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBeNull();
      expect(verifyFloorAtCaps(a)).toBeLessThanOrEqual(a.maxGasPerFrame);
      expect(a.maxPriorityFeePerGas).toBeLessThanOrEqual(a.maxFeePerGas);
      expect(a.maxFeePerGas).toBeLessThanOrEqual(FACTORY_BOUNDS.MAX_FEE_CEILING);
    }
  });

  it("defaults at devnet1 fees (base 7 wei, tip 1 gwei): 4 gwei / 2 gwei caps, 200k gas, 2 slots, minimum balance", () => {
    const a = defaultRuleContractArgs({ logic: LOGIC, baseFee: 7n, suggestedTip: 1_000_000_000n });
    expect(a).toMatchObject({ mode: 0, maxPriorityFeePerGas: 2_000_000_000n, maxFeePerGas: 4_000_000_140n, maxGasPerFrame: 200_000n, maxStateGasPerFrame: 195_840n, conditionGas: 20_000, maxVerifyDataLength: 0, maxTriggerDataLength: 128 });
    // 12,950 + 64 × (0 + 196 + 35) + 2 × 200,000 + 195,840 = 623,574 gas
    expect(maxCostPerTrigger(a)).toBe(623_574n * 4_000_000_140n);
  });

  it("checkRuleContractArgsLocal names each factory bound (both sides)", () => {
    const ok = defaultRuleContractArgs({ logic: LOGIC, baseFee: 7n, suggestedTip: 1n });
    expect(checkRuleContractArgsLocal(ok)).toBeNull();
    const cases: [Partial<RuleContractArgs>, string][] = [
      [{ mode: 2 }, "ModeNotSupported"],
      [{ mode: 1 }, "FeeCapsMustBeZeroInCallerPays"],
      [{ maxFeePerGas: 0n }, "MaxFeeOutOfRange"],
      [{ maxFeePerGas: 1_000_000_000_001n }, "MaxFeeOutOfRange"],
      [{ maxPriorityFeePerGas: ok.maxFeePerGas + 1n }, "PriorityFeeAboveMaxFee"],
      [{ maxGasPerFrame: 16_777_217n }, "GasPerFrameTooHigh"],
      [{ maxStateGasPerFrame: 64n * 97_920n + 1n }, "StateGasTooHigh"],
      [{ maxVerifyDataLength: 8_193 }, "VerifyDataTooLong"],
      [{ maxTriggerDataLength: 4_097 }, "TriggerDataTooLong"],
      [{ conditionGas: 4_999 }, "ConditionGasTooLow"],
      [{ maxGasPerFrame: verifyFloorAtCaps(ok) - 1n }, "VerifyFloorAboveGasPerFrame"],
      [{ maxGasPerFrame: 16_777_216n }, "TxGasAboveCap"],
    ];
    for (const [d, name] of cases) expect(checkRuleContractArgsLocal({ ...ok, ...d })).toBe(name);
    expect(checkRuleContractArgsLocal({ ...ok, maxGasPerFrame: verifyFloorAtCaps(ok) })).toBeNull();
    expect(checkRuleContractArgsLocal({ ...ok, maxFeePerGas: 1_000_000_000_000n })).toBeNull();
    expect(checkRuleContractArgsLocal({ ...ok, conditionGas: 5_000 })).toBeNull();
  });
});

describe("the trigger (rule-pays, 2 frames)", () => {
  it("buildTriggerTx == the reference builder, byte for byte (300 random rule contracts / inputs)", async () => {
    const r = rand(2026);
    for (let i = 0; i < 300; i++) {
      const a = { ...randomArgs(r), logic: LOGIC };
      const argsHex = encodeRuleContractArgs(a);
      const triggerData = toHex(Uint8Array.from({ length: Math.floor(r() * 200) }, () => Math.floor(r() * 256)));
      const verifyData = r() < 0.5 ? "0x" : toHex(Uint8Array.from({ length: Math.floor(r() * 300) }, () => Math.floor(r() * 256)));
      const key = BigInt(keccak256(triggerData));
      const verifyGasLimit = verifyFloor(a, size(verifyData), size(triggerCalldata(triggerData))) + BigInt(Math.floor(r() * 50_000));
      const maxFeePerGas = a.maxFeePerGas / 2n + 1n;
      const maxPriorityFeePerGas = a.maxPriorityFeePerGas / 3n;
      const ours = buildTriggerTx({ ruleContract: RULE_CONTRACT, args: a, chainId: 1337n, triggerData, verifyData, nonceKey: key, verifyGasLimit, maxFeePerGas, maxPriorityFeePerGas });
      const ref = await buildTrigger(refRule(argsHex, key), { triggerData, verifyData, verifyGas: verifyGasLimit, maxFeePerGas, maxPriorityFeePerGas });
      expect(serializeFrameTx(ours)).toBe(serializeFrameTx(ref.tx));
      expect(validateFrameTx(ours)).toEqual([]);
    }
  });

  it("matches contracts/core/LAYOUT.md: modes, targets, flags 3/0, pinned SENDER limits, values 0, pop(bytes) data, key, seq 0, no signatures/blobs/roots", () => {
    const a = defaultRuleContractArgs({ logic: LOGIC, baseFee: 7n, suggestedTip: 1_000_000_000n });
    const triggerData = toHex("reporter");
    const tx = buildTriggerTx({ ruleContract: RULE_CONTRACT, args: a, chainId: 1337n, triggerData, verifyData: "0xabcd", nonceKey: 42n, verifyGasLimit: 40_000n, maxFeePerGas: 15n, maxPriorityFeePerGas: 1n });
    const back = parseFrameTx(serializeFrameTx(tx));
    expect(getAddress(back.sender)).toBe(RULE_CONTRACT);
    expect(back.nonceKeys).toEqual([42n]);
    expect(back.nonceSeq).toBe(0n);
    expect(back.signatures).toEqual([]);
    expect(back.blobHashes).toEqual([]);
    expect(back.recentRootReferences).toEqual([]);
    expect(back.fees).toEqual({ maxFeePerGas: 15n, maxPriorityFeePerGas: 1n, maxFeePerBlobGas: 0n });
    const [f0, f1] = back.frames;
    expect(back.frames).toHaveLength(2);
    expect(f0).toEqual({ mode: FrameMode.VERIFY, flags: 3, target: null, gasLimit: 40_000n, stateGasLimit: 0n, value: 0n, data: "0xabcd" });
    expect(f1).toEqual({ mode: FrameMode.SENDER, flags: FrameFlags.NONE, target: null, gasLimit: a.maxGasPerFrame, stateGasLimit: a.maxStateGasPerFrame, value: 0n, data: triggerCalldata(triggerData) });
    // pop(bytes) selector 0xd9292504, offset 0x20, length, padded
    expect(f1!.data.slice(0, 10)).toBe("0xd9292504");
    expect(f1!.data).toBe(concat(["0xd9292504", encodeAbiParameters([{ type: "bytes" }], [triggerData])]));
    expect(size(f1!.data)).toBe(68 + 32);
  });

  it("verifyFloor == Core's 0x27 formula (10,000 + cg + cg/63 + 7,000 + n0 + n1)", () => {
    expect(verifyFloor({ conditionGas: 20_000 }, 0, 132)).toBe(10_000n + 20_000n + 317n + 7_000n + 132n);
    expect(verifyFloor({ conditionGas: 220_000 }, 256, 196)).toBe(240_944n); // proof rule contract
  });

  it("shadow initcode: prefill SSTOREs, then CODECOPY + DELEGATECALL(gas, logic) + return/revert of returndata", () => {
    const cd = "0x97031c8c" as Hex;
    const s = shadowInitcode([["0x01", "0x07"]], LOGIC, cd, 10_000);
    expect(s.slice(2, 4)).toBe("7f"); // PUSH32 value
    expect(s.slice(2 + 66 * 2, 2 + 67 * 2)).toBe("55"); // SSTORE
    expect(s).toContain(LOGIC.slice(2).toLowerCase());
    expect(s).toContain("62002710f4"); // PUSH3 10,000 DELEGATECALL
    expect(s.endsWith("5b3d6000f397031c8c")).toBe(true); // ok: RETURN, then the calldata
    expect(size(s)).toBe(67 + 63 + 4);
  });
});

describe("Core error table (CORE_ERRORS, generated from contracts/core/LAYOUT.md)", () => {
  it("has every LAYOUT.md code with a stable name", () => {
    expect(Object.keys(CORE_ERRORS)).toHaveLength(layout.codes.length);
    for (const c of layout.codes) expect(CORE_ERRORS[c.code]?.section).toBe(c.section === "VERIFY1" ? "VERIFY" : c.section); // mode-1 VERIFY codes are VERIFY codes
    expect(CORE_ERRORS[0x22]!.name).toBe("CONDITION_FALSE");
    expect(CORE_ERRORS[0x12]!.name).toBe("MAX_FEE_ABOVE_CAP");
    expect(CORE_ERRORS[0x27]!.name).toBe("VERIFY_GAS_BELOW_FLOOR");
    expect(CORE_ERRORS[0x1e]!.name).toBe("NONCE_KEY_MISMATCH");
    expect(CORE_ERRORS[0x37]!.name).toBe("REENTRY_LOCKED");
    expect(new Set(Object.values(CORE_ERRORS).map((e) => e.name)).size).toBe(layout.codes.length);
  });

  const sim = (o: Partial<SimulationResult>): SimulationResult => ({
    executionStatus: null, executionError: null, canonicalMempoolValid: false, canonicalMempoolViolation: null, prefixShape: "SelfVerify", payer: null, gasUsed: null, maxCost: null, frames: null, failedFrameIndex: null, haltReason: null, haltDetail: null, revertData: null, trace: null, traceError: null, raw: {}, ...o,
  });
  it("readinessOf maps ethrex verdicts", () => {
    expect(readinessOf(sim({ executionStatus: "success", canonicalMempoolValid: true }))).toMatchObject({ ready: true, name: "READY", canonical: true });
    expect(readinessOf(sim({ executionStatus: "reverted" }))).toMatchObject({ ready: true, name: "ACTION_REVERTS", actionReverts: true });
    expect(readinessOf(sim({ revertData: `0x${"22".padStart(64, "0")}` }))).toMatchObject({ ready: false, code: 0x22, name: "CONDITION_FALSE" });
    expect(readinessOf(sim({ executionError: "Nonce mismatch: expected 1, got 0" }))).toMatchObject({ ready: false, code: null, name: "NONCE_USED" });
    expect(readinessOf(sim({ executionError: "Insufficient account funds" }))).toMatchObject({ ready: false, name: "INSUFFICIENT_BALANCE" });
  });
});

// ---------------------------------------------------------------- trigger() end to end against stubbed endpoints

describe("trigger() through the viem extension (stubbed devnet)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const d = devnets.devnet1;
  const a: RuleContractArgs = { ...(decodeRuleContractArgs(coreArgs(LOGIC, 0, {})) as RuleContractArgs) };
  const KEY = 0x1234_5678n;
  const VERIFY_USED = 30_000n;

  function stubDevnet(o: { revert?: number; balance?: bigint; noView?: boolean } = {}) {
    const sent: Hex[] = [];
    const methods: string[] = [];
    const calls: { to?: string; data?: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const one = (q: { method: string; params: unknown[]; id: number }) => {
        methods.push(q.method);
        const ok = (result: unknown) => ({ jsonrpc: "2.0", id: q.id, result });
        switch (q.method) {
          case "eth_chainId": return ok("0x539");
          case "eth_getCode": return ok(concat([CORE.runtime, encodeRuleContractArgs(a)]));
          case "eth_getBalance": return ok(toHex(o.balance ?? 10n ** 18n));
          case "eth_getBlockByNumber": return ok({ number: "0x10", hash: `0x${"11".repeat(32)}`, parentHash: `0x${"22".repeat(32)}`, timestamp: "0x1", baseFeePerGas: "0x7", gasLimit: "0x3938700", gasUsed: "0x0", transactions: [], logsBloom: null, miner: d.rpcUrl && "0x0000000000000000000000000000000000000000", nonce: "0x0", difficulty: "0x0", extraData: "0x", size: "0x1", stateRoot: `0x${"00".repeat(32)}`, receiptsRoot: `0x${"00".repeat(32)}`, transactionsRoot: `0x${"00".repeat(32)}`, sha3Uncles: `0x${"00".repeat(32)}`, uncles: [] });
          case "eth_maxPriorityFeePerGas": return ok("0x3b9aca00");
          case "eth_getTransactionCount": return ok("0x0");
          case "debug_traceCall": return ok({});
          case "eth_call": {
            const c = (q.params as { to?: string; data?: string }[])[0]!;
            calls.push(c);
            // popcornNonceKey on the rule contract (a logic built before the view has none: revert)
            if (c.to && o.noView) return { jsonrpc: "2.0", id: q.id, error: { code: 3, message: "execution reverted", data: "0x" } };
            return ok(toHex(KEY, { size: 32 }));
          }
          case "ethrex_simulateFrameTransaction":
            return ok(o.revert !== undefined
              ? { executionStatus: null, executionError: "VERIFY frame 0 failed: RevertOpcode", canonicalMempoolValid: false, revertData: toHex(o.revert, { size: 32 }), failedFrameIndex: 0 }
              : { executionStatus: "success", executionError: null, canonicalMempoolValid: true, prefixShape: "SelfVerify", gasUsed: "0xc350", frames: [{ gasUsed: toHex(VERIFY_USED), succeeded: true }, { gasUsed: "0x4e20", succeeded: true }] });
          case "eth_sendRawTransaction": {
            const raw = (q.params as Hex[])[0]!;
            sent.push(raw);
            return ok(txHash(raw));
          }
          default: return { jsonrpc: "2.0", id: q.id, error: { code: -32601, message: `no stub for ${q.method}` } };
        }
      };
      const out = Array.isArray(body) ? body.map(one) : one(body);
      return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
    });
    return { sent, methods, calls };
  }

  const client = () => createPublicClient({ chain: devnetChain(), transport: http() }).extend(popcorn({ via: "rpc" }));

  it("sends exactly the reference trigger: derived key, VERIFY = max(floor, used + 10%), fees min(cap, 2×base + tip)", async () => {
    const { sent, methods, calls } = stubDevnet();
    const triggerData = toHex("p4 unit");
    const hash = await client().trigger(RULE_CONTRACT, { triggerData });
    expect(sent).toHaveLength(1);
    expect(hash).toBe(txHash(sent[0]!));
    const floor = verifyFloor(a, 0, size(triggerCalldata(triggerData)));
    const want = VERIFY_USED + 3_000n > floor ? VERIFY_USED + 3_000n : floor;
    const tip = 1_000_000_000n; // min(cap 2 gwei, suggested 1 gwei)
    const ref = await buildTrigger(refRule(encodeRuleContractArgs(a), KEY), { triggerData, verifyGas: want, maxFeePerGas: 7n * 2n + tip, maxPriorityFeePerGas: tip });
    expect(sent[0]).toBe(serializeFrameTx(ref.tx));
    // nonce key from the rule contract's own popcornNonceKey view (its real address and storage); no shadow run
    expect(calls.some((c) => c.to?.toLowerCase() === RULE_CONTRACT.toLowerCase() && c.data?.startsWith("0x8325c482"))).toBe(true);
    expect(methods).not.toContain("debug_traceCall");
    expect(methods.filter((m) => m === "ethrex_simulateFrameTransaction").length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to the shadow run when the logic predates popcornNonceKey", async () => {
    const { sent, methods } = stubDevnet({ noView: true });
    const triggerData = toHex("p4 unit");
    await client().trigger(RULE_CONTRACT, { triggerData });
    expect(sent).toHaveLength(1);
    expect(methods).toContain("debug_traceCall");
  });

  it("RuleContractNotReady(0x22 CONDITION_FALSE) and nothing sent when the simulation says the condition is false", async () => {
    const { sent } = stubDevnet({ revert: 0x22 });
    const e = await client().trigger(RULE_CONTRACT, { triggerData: "0x01" }).catch((x) => x);
    expect(e).toBeInstanceOf(RuleContractNotReady);
    expect(e).toMatchObject({ code: 0x22, coreName: "CONDITION_FALSE" });
    expect(sent).toHaveLength(0);
  });

  it("FeeAboveCap for a requested fee above the rule contract's cap, before any simulation", async () => {
    const { sent, methods } = stubDevnet();
    const e = await client().trigger(RULE_CONTRACT, { triggerData: "0x01", fees: { maxFeePerGas: a.maxFeePerGas + 1n } }).catch((x) => x);
    expect(e).toBeInstanceOf(FeeAboveCap);
    expect(sent).toHaveLength(0);
    expect(methods).not.toContain("ethrex_simulateFrameTransaction");
  });

  it("InsufficientRuleContractBalance when the rule contract cannot cover this trigger's max cost", async () => {
    const { sent } = stubDevnet({ balance: 1000n });
    const e = await client().trigger(RULE_CONTRACT, { triggerData: "0x01" }).catch((x) => x);
    expect(e).toBeInstanceOf(InsufficientRuleContractBalance);
    expect(sent).toHaveLength(0);
  });

  it("DEFAULT_ARGS of the reference are what the stubbed rule contract carries (sanity)", () => {
    expect(a.maxGasPerFrame).toBe(DEFAULT_ARGS.maxGasPerFrame);
  });
});
