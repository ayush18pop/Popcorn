// Generates the artifacts the SDK ships, from the build outputs:
//   contracts/core/out/PopcornCore.json              (contracts/core/build.sh)
//   contracts/out/RuleFactory.sol/RuleFactory.json   (forge build)
//   contracts/core/LAYOUT.md                          (Core error codes)
// into packages/sdk/src/artifacts/*.generated.ts.
//
// Checks: keccak256(Core creation code) == the factory's pinned CORE_CREATION_CODE_HASH; the runtime is the tail of the
// creation code; every Core error code in LAYOUT.md has a name below and every name has a code in LAYOUT.md.
//
// Usage: bun scripts/gen-artifacts.ts   (from packages/sdk; run contracts/core/build.sh and forge build first)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { keccak256, type Hex } from "viem";

const ROOT = new URL("../../../", import.meta.url).pathname;
const OUT = new URL("../src/artifacts/", import.meta.url).pathname;

// ---------------------------------------------------------------- Core
const core = JSON.parse(readFileSync(`${ROOT}contracts/core/out/PopcornCore.json`, "utf8")) as {
  version: string;
  compiler: string;
  evmVersion: string;
  creation: string;
  runtime: string;
  argsLength: number;
  initArgsLength?: number;
  constants: Record<string, number | string>;
  selectors: Record<string, string>;
};
const hex = (s: string): Hex => (s.startsWith("0x") ? s : `0x${s}`).toLowerCase() as Hex;
const creation = hex(core.creation);
const runtime = hex(core.runtime);
if (!creation.endsWith(runtime.slice(2))) throw new Error("Core runtime is not the tail of the creation code");
const creationHash = keccak256(creation);

// ---------------------------------------------------------------- factory
const factoryJson = JSON.parse(readFileSync(`${ROOT}contracts/out/RuleFactory.sol/RuleFactory.json`, "utf8")) as {
  abi: unknown[];
  bytecode: { object: string };
};
const factorySrc = readFileSync(`${ROOT}contracts/src/rules/RuleFactory.sol`, "utf8");
const pinned = factorySrc.match(/CORE_CREATION_CODE_HASH\s*=\s*(0x[0-9a-fA-F]{64})/)?.[1]?.toLowerCase();
if (!pinned) throw new Error("RuleFactory.sol: CORE_CREATION_CODE_HASH not found");
if (pinned !== creationHash) {
  throw new Error(`Core creation hash ${creationHash} != factory's pinned CORE_CREATION_CODE_HASH ${pinned}: rebuild core/ or update the factory`);
}

// ---------------------------------------------------------------- Core error codes (contracts/core/LAYOUT.md)
/** Stable names for Core's revert codes. A LAYOUT.md code without a name here (or the reverse) fails the script. */
const NAMES: Record<number, string> = {
  0x01: "MODE_NOT_RULE_PAYS",
  0x02: "NOT_FRAME_0",
  0x03: "FRAME0_NOT_VERIFY",
  0x04: "TX_SENDER_NOT_RULE_CONTRACT",
  0x05: "NOT_TWO_FRAMES",
  0x06: "FRAME0_TARGET_NOT_RULE_CONTRACT",
  0x07: "FRAME0_FLAGS_NOT_3",
  0x08: "FRAME1_NOT_SENDER",
  0x09: "FRAME1_TARGET_NOT_RULE_CONTRACT",
  0x0a: "FRAME1_FLAGS_NOT_0",
  0x0b: "NOT_ONE_NONCE_KEY",
  0x0c: "HAS_SIGNATURES",
  0x0d: "HAS_BLOBS",
  0x0e: "NOT_POP_CALLDATA",
  0x0f: "TRIGGER_DATA_BAD_OFFSET",
  0x10: "TRIGGER_DATA_BAD_LENGTH",
  0x11: "POP_CALLDATA_NOT_CANONICAL",
  0x12: "MAX_FEE_ABOVE_CAP",
  0x13: "PRIORITY_FEE_ABOVE_CAP",
  0x14: "VERIFY_GAS_ABOVE_CAP",
  0x15: "SENDER_GAS_NOT_PINNED",
  0x16: "VERIFY_STATE_GAS_NOT_ZERO",
  0x17: "SENDER_STATE_GAS_NOT_PINNED",
  0x18: "FRAME0_HAS_VALUE",
  0x19: "FRAME1_HAS_VALUE",
  0x1a: "TOTAL_DEBIT_ABOVE_BOUND",
  0x1b: "NONCE_KEY_CALL_FAILED",
  0x1c: "NONCE_KEY_BAD_RETURN",
  0x1d: "NONCE_KEY_ZERO",
  0x1e: "NONCE_KEY_MISMATCH",
  0x1f: "NONCE_SEQ_NOT_ZERO",
  0x20: "CONDITION_CALL_FAILED",
  0x21: "CONDITION_BAD_RETURN",
  0x22: "CONDITION_FALSE",
  0x23: "HAS_RECENT_ROOTS",
  0x24: "VERIFY_DATA_TOO_LONG",
  0x25: "TRIGGER_DATA_TOO_LONG",
  0x26: "TRIGGER_DATA_BAD_PADDING",
  0x27: "VERIFY_GAS_BELOW_FLOOR",
  0x30: "NOT_SENDER_FRAME",
  0x31: "SENDER_MODE_NOT_RULE_PAYS",
  0x32: "SENDER_NOT_POP_CALLDATA",
  0x33: "SENDER_TRIGGER_DATA_BAD_OFFSET",
  0x34: "SENDER_TRIGGER_DATA_BAD_LENGTH",
  0x35: "SENDER_POP_CALLDATA_NOT_CANONICAL",
  0x36: "SENDER_TRIGGER_DATA_BAD_PADDING",
  0x37: "REENTRY_LOCKED",
  0x38: "FORWARD_RESERVED_SELECTOR",
  0x39: "FORWARD_DURING_ACTION",
  0x3a: "FORWARD_SHORT_CALLDATA",
  0x3b: "SENDER_NOT_OWN_POP",
  0x3c: "SENDER_NOT_FRAME_1",
  0x40: "SP_FRAME_COUNT",
  0x41: "SP_FRAME0_FLAGS_NOT_2",
  0x42: "SP_PAYER_FRAME_NOT_VERIFY",
  0x43: "SP_PAYER_IS_RULE_CONTRACT",
  0x44: "SP_PAYER_FLAGS_NOT_1",
  0x45: "SP_FRAME2_NOT_SENDER",
  0x46: "SP_FRAME2_TARGET_NOT_RULE_CONTRACT",
  0x47: "SP_FRAME2_FLAGS_NOT_0",
  0x48: "SP_TAIL_NOT_DEFAULT",
  0x49: "SP_TAIL_TARGETS_RULE_CONTRACT",
  0x4a: "SP_TAIL_FLAGS_NOT_0",
  0x4b: "SP_TAIL_HAS_VALUE",
  0x50: "OWNER_FRAME_COUNT",
  0x51: "OWNER_KEY_MISMATCH",
  0x52: "OWNER_SIGNATURE_COUNT",
  0x53: "OWNER_CALL_TOO_LONG",
  0x54: "OWNER_CALL_NO_SELECTOR",
  0x55: "OWNER_CALL_RESERVED_SELECTOR",
  0x56: "OWNER_BUMP_GAS_OUT_OF_RANGE",
  0x57: "OWNER_ECDSA_NOT_ARBITRARY",
  0x58: "OWNER_ECDSA_MSG_NOT_EMPTY",
  0x59: "OWNER_ECDSA_BAD_LENGTH",
  0x5a: "OWNER_WOTS_NOT_ARBITRARY",
  0x5b: "OWNER_WOTS_MSG_NOT_EMPTY",
  0x5c: "OWNER_WOTS_BAD_LENGTH",
  0x5d: "OWNER_NOT_CONFIGURED",
  0x5e: "OWNER_VERIFY_DATA_NOT_EMPTY",
  0x5f: "OWNER_ECDSA_MISMATCH",
  0x60: "OWNER_LEAF_OUT_OF_RANGE",
  0x61: "OWNER_LEAF_SPENT",
  0x62: "OWNER_WOTS_INVALID",
  0x63: "OWNER_BUMP_NOT_DONE",
  0x65: "OWNER_BUMP_DATA",
  0x66: "OWNER_CALL_FRAME_NOT_SENDER",
  0x67: "OWNER_CALL_FRAME_TARGET",
  0x68: "OWNER_CALL_FRAME_FLAGS",
  0x69: "OWNER_CALL_FRAME_SELECTOR",
  0x6a: "OWNER_ECDSA_MALLEABLE",
};

interface Row {
  code: number;
  name: string;
  section: "VERIFY" | "SENDER" | "FORWARD" | "OWNER";
  check: string;
}
const md = readFileSync(`${ROOT}contracts/core/LAYOUT.md`, "utf8");
const rows: Row[] = [];
let section = "";
let inCodes = false;
for (const line of md.split("\n")) {
  if (/^#{2,4} /.test(line)) {
    section = line.replace(/^#+ /, "");
    inCodes = false;
    continue;
  }
  if (!line.trim().startsWith("|")) {
    inCodes = false;
    continue;
  }
  const c = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((x) => x.trim());
  if (c.every((x) => /^:?-+:?$/.test(x))) continue;
  if (c[0] === "Code" && c.includes("Check")) {
    inCodes = true;
    continue;
  }
  if (!inCodes) continue;
  const m = c[0]!.replace(/`/g, "").match(/^0x([0-9a-f]+)(?:\s*[-–]\s*0x([0-9a-f]+))?$/i);
  if (!m) continue;
  const lo = parseInt(m[1]!, 16);
  const hi = m[2] ? parseInt(m[2], 16) : lo;
  const check = c[c.length - 1]!.replace(/`/g, "");
  for (let k = lo; k <= hi; k++) {
    const name = NAMES[k];
    if (!name) throw new Error(`contracts/core/LAYOUT.md code 0x${k.toString(16)} ("${check}") has no name in gen-artifacts.ts`);
    rows.push({ code: k, name, section: /^FORWARD/i.test(section) ? "FORWARD" : /^OWNER path/i.test(section) ? "OWNER" : /caller-pays/i.test(section) ? "VERIFY" : /SENDER/i.test(section) ? "SENDER" : "VERIFY", check: lo === hi ? check : `${check} (code 0x${k.toString(16)} of 0x${lo.toString(16)}-0x${hi.toString(16)})` });
  }
}
for (const k of Object.keys(NAMES).map(Number)) {
  if (!rows.some((r) => r.code === k)) throw new Error(`name ${NAMES[k]} (0x${k.toString(16)}) is not a code in contracts/core/LAYOUT.md`);
}
rows.sort((a, b) => a.code - b.code);

// ---------------------------------------------------------------- write
mkdirSync(OUT, { recursive: true });
const header = (src: string) => `// GENERATED by packages/sdk/scripts/gen-artifacts.ts from ${src}. Do not edit; re-run the script.\n`;
const j = (v: unknown) => JSON.stringify(v, null, 2);

writeFileSync(
  `${OUT}core.generated.ts`,
  `${header("contracts/core/out/PopcornCore.json")}import type { CoreArtifact } from "./coreArtifact.ts";

export const CORE: CoreArtifact = {
  version: ${j(core.version)},
  compiler: ${j(core.compiler)},
  evmVersion: ${j(core.evmVersion)},
  creation: ${j(creation)},
  runtime: ${j(runtime)},
  creationHash: ${j(creationHash)},
  runtimeHash: ${j(keccak256(runtime))},
  argsLength: ${core.argsLength},
  initArgsLength: ${core.initArgsLength ?? core.argsLength},
  constants: {
    nonceKeyGas: ${BigInt(core.constants.nonceKeyGas!)}n,
    verifyFixedGas: ${BigInt(core.constants.verifyFixedGas!)}n,
    mandatoryGas: ${BigInt(core.constants.mandatoryGas!)}n,
    floorPerByte: ${BigInt(core.constants.floorPerByte!)}n,
    nonceRlpBytes: ${BigInt(core.constants.nonceRlpBytes!)}n,
    lockSlot: ${j(core.constants.lockSlot)},
  },
  selectors: {
    pop: ${j(core.selectors["pop(bytes)"])},
    nonceKey: ${j(core.selectors["__nonceKey(bytes)"])},
    condition: ${j(core.selectors["__condition(bytes,bytes)"])},
    action: ${j(core.selectors["__action(bytes,address)"])},
    ${core.selectors["owner(bytes)"] ? `owner: ${j(core.selectors["owner(bytes)"])},
    ownerBump: ${j(core.selectors["ownerBump()"])},` : ""}
  },
};
`,
);

writeFileSync(
  `${OUT}factory.generated.ts`,
  `${header("contracts/out/RuleFactory.sol/RuleFactory.json")}import type { Hex } from "viem";

/** keccak256 of the Core creation code this factory build accepts (RuleFactory.CORE_CREATION_CODE_HASH). */
export const FACTORY_CORE_CREATION_CODE_HASH: Hex = ${j(pinned)};

export const ruleFactoryAbi = ${j(factoryJson.abi)} as const;

/** Factory creation code; constructor(bytes coreCreationCode). */
export const ruleFactoryBytecode: Hex = ${j(hex(factoryJson.bytecode.object))};
`,
);

writeFileSync(
  `${OUT}coreErrors.generated.ts`,
  `${header("contracts/core/LAYOUT.md")}
export interface CoreErrorInfo {
  code: number;
  /** Stable name (SCREAMING_CASE). Plain-English messages live in @popcorn/simulator. */
  name: string;
  /** VERIFY codes make the transaction invalid (nobody pays); SENDER codes revert the action; FORWARD codes revert an
   *  ordinary call to the rule contract. */
  section: "VERIFY" | "SENDER" | "FORWARD" | "OWNER";
  /** The "Check" column of contracts/core/LAYOUT.md. */
  check: string;
}

export const CORE_ERRORS: Readonly<Record<number, CoreErrorInfo>> = {
${rows.map((r) => `  0x${r.code.toString(16).padStart(2, "0")}: ${JSON.stringify(r)},`).join("\n")}
};
`,
);
console.log(`wrote ${OUT}: Core ${core.version} creation ${creationHash} (matches the factory pin), ${rows.length} error codes`);
