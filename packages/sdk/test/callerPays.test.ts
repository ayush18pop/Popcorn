// unit tests (no network): the caller-pays trigger layout (Core mode 1), payer signing, mode-1 arg rules.
import { keccak256, recoverAddress, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  CORE,
  DEFAULT_PAYER_GAS_LIMIT,
  PAYER_PLACEHOLDER_MSG,
  prefixGasAtCaps,
  FrameFlags,
  FrameMode,
  SignatureScheme,
  buildCallerPaysTriggerTx,
  checkRuleContractArgsLocal,
  defaultRuleContractArgs,
  maxCostPerTrigger,
  parseFrameTx,
  triggerCalldata,
  serializeFrameTx,
  signSecp256k1Entry,
  signatureHash,
  type RuleContractArgs,
} from "../src/index.ts";

const ruleContract: Hex = "0x1111111111111111111111111111111111111111";
const payer = privateKeyToAccount(generatePrivateKey());
const input = {
  ruleContract,
  args: { maxGasPerFrame: 90_000n, maxStateGasPerFrame: 195_840n },
  chainId: 1337n,
  triggerData: "0xc0ffee" as Hex,
  verifyData: "0x" as Hex,
  nonceKey: 42n,
  verifyGasLimit: 40_000n,
  maxFeePerGas: 2_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
  payer: payer.address,
  payerGasLimit: DEFAULT_PAYER_GAS_LIMIT,
};

describe("buildCallerPaysTriggerTx (contracts/core/LAYOUT.md 'VERIFY, caller-pays')", () => {
  it("frames [VERIFY 2 → rule contract, VERIFY 1 → payer, SENDER 0 → rule contract], EOA signature slots [ARBITRARY, SECP256K1 payer]", () => {
    const t = buildCallerPaysTriggerTx(input);
    expect(t.frames.map((f) => [f.mode, f.flags, f.target])).toEqual([
      [FrameMode.VERIFY, FrameFlags.APPROVE_EXECUTION, null],
      [FrameMode.VERIFY, FrameFlags.APPROVE_PAYMENT, payer.address],
      [FrameMode.SENDER, FrameFlags.NONE, null],
    ]);
    expect(t.frames[2]!.gasLimit).toBe(90_000n); // pinned
    expect(t.frames[2]!.stateGasLimit).toBe(195_840n);
    expect(t.frames[2]!.data).toBe(triggerCalldata("0xc0ffee", CORE));
    expect(t.frames[1]!.gasLimit).toBe(30_000n);
    expect(t.signatures.map((s) => s.scheme)).toEqual([SignatureScheme.ARBITRARY, SignatureScheme.SECP256K1]);
    expect(t.signatures[1]!.signer).toBe(payer.address.toLowerCase());
    expect(t.nonceKeys).toEqual([42n]);
    expect(t.sender).toBe(ruleContract);
  });

  it("the payer's signature (signatures[1]) recovers to the payer over the sig hash, and covers every frame", async () => {
    const t = await signSecp256k1Entry(buildCallerPaysTriggerTx(input), 1, payer);
    const sig = t.signatures[1]!.signature;
    const v = Number.parseInt(sig.slice(2, 4), 16);
    const recovered = await recoverAddress({ hash: signatureHash(t), signature: `0x${sig.slice(4)}${(27 + v).toString(16)}` as Hex });
    expect(recovered).toBe(payer.address);
    // changing the rule contract's triggerData changes the hash the payer signed
    const other = { ...t, frames: t.frames.map((f, i) => (i === 2 ? { ...f, data: triggerCalldata("0xbad0", CORE) } : f)) };
    expect(signatureHash(other)).not.toBe(signatureHash(t));
    // round trip
    expect(serializeFrameTx(parseFrameTx(serializeFrameTx(t)))).toBe(serializeFrameTx(t));
  });

  it("contract payer: no signatures; tail: a 4th DEFAULT frame, never the rule contract; payer never the rule contract", () => {
    expect(buildCallerPaysTriggerTx({ ...input, payerKind: "contract" }).signatures).toEqual([]);
    const t = buildCallerPaysTriggerTx({ ...input, tail: { target: payer.address, data: "0x01", gasLimit: 21_000n } });
    expect(t.frames[3]).toMatchObject({ mode: FrameMode.DEFAULT, flags: 0, target: payer.address, value: 0n, data: "0x01" });
    expect(() => buildCallerPaysTriggerTx({ ...input, tail: { target: ruleContract, data: "0x", gasLimit: 1n } })).toThrow(/0x49/);
    expect(() => buildCallerPaysTriggerTx({ ...input, payer: ruleContract })).toThrow(/0x43/);
  });

  it("matches the layout of the recorded EOA-payer transaction ethrex included", () => {
    const e2 = parseFrameTx(
      "0x06f8e9820539c38207d48094ec3bd98961e0931090950bf84ff64fabe60ad948f859ca010280c4827530808080de010194ebe14f3b5c632a3b8d680978744c2206e830d368c4829c40808080ee028080c8830493e08316e36080a00000000000000000000000000000000000000000000000000000000000c0ffeef861c480808080f85a0194ebe14f3b5c632a3b8d680978744c2206e830d36880b841005b1ca297283f5ff83aabaf8bc1f0d092cbb92b8b5c7ef781207d2c3e80c7f471345dcb5c86405506fbc17f985133bdce742e4bc73df93a6f6dfa4d9694b33962cb843b9aca00847735940080c0c0",
    );
    const ours = buildCallerPaysTriggerTx({ ...input, payer: e2.frames[1]!.target! });
    expect(ours.frames.map((f) => [f.mode, f.flags, f.target === null])).toEqual(e2.frames.map((f) => [f.mode, f.flags, f.target === null]));
    expect(ours.signatures.map((s) => [s.scheme, s.signer])).toEqual(e2.signatures.map((s) => [s.scheme, s.signer]));
    // The recorded transaction had an empty placeholder msg; ours is PAYER_PLACEHOLDER_MSG (empty-msg bytes are unsigned, paddable)
    expect(ours.signatures[0]!.msg).toBe(PAYER_PLACEHOLDER_MSG);
    expect(ours.signatures[1]!.msg).toBe(e2.signatures[1]!.msg);
  });
});

describe("signatures[0] padding", () => {
  it("the placeholder's bytes are covered by the payer's sig hash: padding them changes the hash the payer signed", async () => {
    const t = await signSecp256k1Entry(buildCallerPaysTriggerTx(input), 1, payer);
    const padded = { ...t, signatures: [{ ...t.signatures[0]!, signature: ("0x" + "ff".repeat(20_000)) as Hex }, t.signatures[1]!] };
    expect(signatureHash(padded)).not.toBe(signatureHash(t));
    expect(keccak256(toHex("popcorn.senderpays.placeholder"))).toBe(PAYER_PLACEHOLDER_MSG);
  });
});

describe("mode-1 rule contract args", () => {
  const base: RuleContractArgs = { logic: ruleContract, mode: 1, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, maxGasPerFrame: 300_000n, maxStateGasPerFrame: 391_680n, verifier: "0x0000000000000000000000000000000000000000", conditionGas: 40_000, maxVerifyDataLength: 0, maxTriggerDataLength: 32 };
  it("fee caps must be 0; the rule contract's max cost per trigger is 0", () => {
    expect(checkRuleContractArgsLocal(base)).toBeNull();
    expect(checkRuleContractArgsLocal({ ...base, maxFeePerGas: 1n })).toBe("FeeCapsMustBeZeroInCallerPays");
    expect(maxCostPerTrigger(base)).toBe(0n);
    expect(maxCostPerTrigger({ ...base, mode: 0, maxFeePerGas: 1n })).toBeGreaterThan(0n);
  });
  it("prefixGasAtCaps mirrors the factory (mode 1: floor + 30,000 + 2,900)", () => {
    expect(prefixGasAtCaps({ ...base, conditionGas: 20_000, maxTriggerDataLength: 64 })).toBe(37_449n + 32_900n);
    expect(prefixGasAtCaps({ ...base, mode: 0, conditionGas: 20_000, maxTriggerDataLength: 64 })).toBe(37_449n);
  });
  it("defaultRuleContractArgs({ mode: 1 }) zeroes the fee caps", () => {
    const a = defaultRuleContractArgs({ logic: ruleContract, baseFee: 7n, suggestedTip: 1_000_000_000n, mode: 1 });
    expect([a.mode, a.maxFeePerGas, a.maxPriorityFeePerGas]).toEqual([1, 0n, 0n]);
    expect(checkRuleContractArgsLocal(a)).toBeNull();
  });
});
