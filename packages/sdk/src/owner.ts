// Hybrid owner: owner-only rule contract calls authorised by BOTH an ECDSA and a post-quantum WOTS+ signature.
// Protocol and checks: contracts/core/LAYOUT.md "OWNER" (Core). This file is the client side:
//   - buildOwnerTx          the exact frame tx Core's verifyOwner accepts (rule-pays, or caller-pays with a payer)
//   - hybridSigner          holds the ECDSA key and the WOTS+ tree; signs the tx's sig hash with both and NEVER reuses a leaf
//   - generateHybridKeys    creates and stores a fresh owner (key material under a path you choose; never commit it)
//   - readOwnerState        the owner slots and the OWNER_KEY sequence from the chain
//   - ownerAction           build -> preflight -> grind a cheap sig hash -> sign once -> simulate -> send -> watch
//
// WOTS+ STATE. A WOTS+ leaf is a ONE-TIME key: two signatures with one leaf can leak enough to forge. The signer therefore
// writes "next leaf" to its store BEFORE it returns a signature, and every signature it ever produced counts as spent,
// whether or not the tx landed (a tx that was signed but dropped or replaced wastes its leaf; Core accepts any leaf >=
// wotsIndex, so skipping is free). Keep the store next to the key, back both up, and never let two processes or two rule contracts
// share one tree: the on-chain index is per rule contract, so a tree used for two rule contracts would reuse leaves across them.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { concat, encodeAbiParameters, getAddress, keccak256, pad, parseSignature, size, toFunctionSelector, toHex, type Address, type Hex, type LocalAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { readRuleContract, resolveVia, watch, type PopcornContext } from "./actions.ts";
import { signatureHash, signSecp256k1Entry, serializeFrameTx, type HashSigner } from "./encoder.ts";
import { RuleContractNotReady, NotAdmitted, PayerRequired, PopcornError, RpcError } from "./errors.ts";
import { DEFAULT_PAYER_GAS_LIMIT, PAYER_PLACEHOLDER_MSG } from "./ruleContract.ts";
import { CORE_ERRORS } from "./artifacts/coreErrors.generated.ts";
import { sendFrameTransaction, simulateFrameTransaction, getReceipt, type FrameTxReceipt, type SimulationResult } from "./transport.ts";
import { FrameFlags, FrameMode, NONCE_MANAGER, SignatureScheme, type Frame, type FrameTx, type SignatureEntry } from "./types.ts";
import { assertValidFrameTx } from "./validate.ts";
import {
  WOTS_ENTRY_BYTES,
  WOTS_LEAVES,
  wotsKeygen,
  wotsSign,
  wotsSteps,
  wotsVerify,
  type WotsTree,
} from "./wots.ts";

// ---------------------------------------------------------------- constants (== contracts/core/PopcornCore.yul)

/** The nonce key of every owner tx: keccak256("popcorn.owner.key"). Its sequence is the ordinary EIP-8250 sequence. */
export const OWNER_KEY: bigint = BigInt(keccak256(toHex("popcorn.owner.key")));
export const SEL_OWNER: Hex = "0xbd27b241"; // owner(bytes)
export const SEL_OWNER_BUMP: Hex = "0x91b5d060"; // ownerBump()
/** keccak256("popcorn.core.owner"): slot 0 = ecdsa | wotsIndex << 160, +1 wotsRoot, +2 wotsPubSeed. */
export const OWNER_BASE_SLOT: Hex = "0x6c5153798c380854dc793bae6a86335313b83f008f4ecf20cd663a8aa18e7c27";
export const OWNER_LIMITS = {
  maxVerifyGas: 400_000n,
  minBumpGas: 30_000n,
  maxBumpGas: 100_000n,
  maxCallGas: 2_000_000n,
  maxCallStateGas: 600_000n,
  maxCallBytes: 1_024,
  ecdsaBytes: 65,
  wotsEntryBytes: WOTS_ENTRY_BYTES,
} as const;
/** Gas of the owner VERIFY frame besides the WOTS hash steps, measured on the local devnet. */
export const OWNER_VERIFY_BASE_GAS = 30_300n; // measured 30,113 (first owner tx: 105,058 at 495 steps incl. 20,000 first use)
export const WOTS_STEP_GAS = 111n;
/** The first use of a nonce key costs 20,000 more in the frame that approves payment (SPEC §7). */
export const KEY_FIRST_USE_GAS = 20_000n;
/** Public ethrex / upstream sidecar: prefix (VERIFY limits + signature cost) <= 100,000; two ARBITRARY entries cost 200. */
export const PUBLIC_OWNER_VERIFY_BUDGET = 99_800n;
/** Hash steps below which Core's WOTS verifier practically never goes (20,000 random sig hashes: min 360, mean 506, max 660). */
export const WOTS_MIN_STEPS = 360;
/** The last leaves are kept for key rotation only (the SDK refuses other owner calls past leaf 1016). */
export const RESERVED_ROTATION_LEAVES = 8;
export const SEL_ROTATE: Hex = toFunctionSelector("ownerRotate(address,bytes32,bytes32)");
export const SEL_FINALIZE: Hex = "0x13077cfd"; // ownerFinalizeRotation(): verified by Core against the pending keys
export const SEL_CANCEL_ROTATION: Hex = toFunctionSelector("ownerCancelRotation()");
/** Local devnet: ethrex 250,000 (sidecar 250,000 unstaked). */
export const LOCAL_OWNER_VERIFY_BUDGET = 249_800n;

/** The owner as the factory/Core take it at deploy (all zero = no owner). */
export interface OwnerInit {
  ecdsa: Address;
  wotsRoot: Hex;
  wotsPubSeed: Hex;
}
export const ZERO32: Hex = `0x${"00".repeat(32)}`;
export const NO_OWNER: OwnerInit = { ecdsa: "0x0000000000000000000000000000000000000000", wotsRoot: ZERO32, wotsPubSeed: ZERO32 };

/** The 84 owner bytes of the Core initcode. */
export const encodeOwnerInit = (o: OwnerInit): Hex => concat([o.ecdsa, o.wotsRoot, o.wotsPubSeed]);

// ---------------------------------------------------------------- the tx

/** SENDER data of the call frame: `owner(bytes call)`. */
export function ownerCallData(call: Hex): Hex {
  if (size(call) < 4 || size(call) > OWNER_LIMITS.maxCallBytes) throw new PopcornError(`owner call must be 4..${OWNER_LIMITS.maxCallBytes} bytes, got ${size(call)}`);
  return concat([SEL_OWNER, encodeAbiParameters([{ type: "bytes" }], [call])]);
}

export interface OwnerTxInput {
  ruleContract: Address;
  /** Core mode of the rule contract: 0 rule-pays, 1 caller-pays. */
  mode: number;
  chainId: bigint;
  /** The OWNER_KEY sequence now (NONCE_MANAGER). */
  seq: bigint;
  call: Hex;
  verifyGasLimit: bigint;
  /** Bump frame limit, 30,000..100,000. Varying it is how `ownerAction` grinds a cheap signature hash. */
  bumpGasLimit: bigint;
  callGasLimit: bigint;
  callStateGasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Mode 1: who pays, and its frame limit. */
  payer?: Address;
  payerGasLimit?: bigint;
  /** Mode 1: "eoa" (default): signatures = [placeholder, payer SECP256K1 (unsigned)]; "contract": none. */
  payerKind?: "eoa" | "contract";
}

/** The placeholder owner entries: right lengths, zero bytes (their bytes are elided from the hash they sign). */
export const ownerPlaceholderEntries = (): SignatureEntry[] => [
  { scheme: SignatureScheme.ARBITRARY, signer: null, msg: "0x", signature: `0x${"00".repeat(OWNER_LIMITS.ecdsaBytes)}` },
  { scheme: SignatureScheme.ARBITRARY, signer: null, msg: "0x", signature: `0x${"00".repeat(OWNER_LIMITS.wotsEntryBytes)}` },
];

/**
 * The exact owner tx (contracts/core/LAYOUT.md "OWNER"):
 *   mode 0: [0] VERIFY flags 3 -> rule contract (data empty), [1] SENDER ownerBump(), [2] SENDER owner(call);
 *           signatures [ECDSA entry, WOTS entry]; nonce key OWNER_KEY at `seq`.
 *   mode 1: [0] VERIFY flags 2 -> rule contract, [1] VERIFY flags 1 -> payer, [2] bump, [3] call;
 *           signatures [payer's entries..., ECDSA entry, WOTS entry].
 * The owner entries are placeholders until a HybridSigner signs the tx; an EOA payer signs last (signSecp256k1Entry).
 */
export function buildOwnerTx(i: OwnerTxInput): FrameTx {
  const frames: Frame[] = [];
  const m = i.mode;
  if (m === 0) {
    frames.push({ mode: FrameMode.VERIFY, flags: FrameFlags.APPROVE_EXECUTION_AND_PAYMENT, target: null, gasLimit: i.verifyGasLimit, stateGasLimit: 0n, value: 0n, data: "0x" });
  } else {
    if (!i.payer) throw new PayerRequired(i.ruleContract);
    if (getAddress(i.payer) === getAddress(i.ruleContract)) throw new PopcornError("payer must not be the rule contract (Core 0x43)");
    frames.push({ mode: FrameMode.VERIFY, flags: FrameFlags.APPROVE_EXECUTION, target: null, gasLimit: i.verifyGasLimit, stateGasLimit: 0n, value: 0n, data: "0x" });
    frames.push({ mode: FrameMode.VERIFY, flags: FrameFlags.APPROVE_PAYMENT, target: getAddress(i.payer), gasLimit: i.payerGasLimit ?? DEFAULT_PAYER_GAS_LIMIT, stateGasLimit: 0n, value: 0n, data: "0x" });
  }
  frames.push({ mode: FrameMode.SENDER, flags: FrameFlags.NONE, target: null, gasLimit: i.bumpGasLimit, stateGasLimit: 0n, value: 0n, data: SEL_OWNER_BUMP });
  frames.push({ mode: FrameMode.SENDER, flags: FrameFlags.NONE, target: null, gasLimit: i.callGasLimit, stateGasLimit: i.callStateGasLimit, value: 0n, data: ownerCallData(i.call) });
  const payerEntries: SignatureEntry[] =
    m === 1 && (i.payerKind ?? "eoa") === "eoa"
      ? [
          { scheme: SignatureScheme.ARBITRARY, signer: null, msg: PAYER_PLACEHOLDER_MSG, signature: "0x" },
          { scheme: SignatureScheme.SECP256K1, signer: getAddress(i.payer!).toLowerCase() as Address, msg: "0x", signature: "0x" },
        ]
      : [];
  return {
    chainId: i.chainId,
    nonceKeys: [OWNER_KEY],
    nonceSeq: i.seq,
    sender: getAddress(i.ruleContract),
    frames,
    signatures: [...payerEntries, ...ownerPlaceholderEntries()],
    fees: { maxPriorityFeePerGas: i.maxPriorityFeePerGas, maxFeePerGas: i.maxFeePerGas, maxFeePerBlobGas: 0n },
    blobHashes: [],
    recentRootReferences: [],
  };
}

// ---------------------------------------------------------------- leaf store + hybrid signer

/** Where the signer keeps "the next unused leaf". `set` must be durable before it returns. */
export interface LeafStore {
  get(): number;
  set(next: number): void;
}

export const memoryLeafStore = (start = 0): LeafStore => {
  let n = start;
  return { get: () => n, set: (v) => void (n = v) };
};

/** JSON file `{ "nextLeaf": n }`, rewritten atomically and fsynced on every `set` (so a crash cannot reuse a leaf). */
export function fileLeafStore(path: string): LeafStore {
  const read = (): number => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { nextLeaf: number }).nextLeaf : 0);
  return {
    get: read,
    set: (next) => {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      const fd = openSync(tmp, "w", 0o600);
      writeSync(fd, JSON.stringify({ nextLeaf: next }) + "\n");
      fsyncSync(fd);
      closeSync(fd);
      renameSync(tmp, path);
      const dfd = openSync(dirname(path), "r"); // the rename itself must survive a crash too
      try {
        fsyncSync(dfd);
      } finally {
        closeSync(dfd);
      }
    },
  };
}

/** A leaf below the signer's next unused one (it was already signed with), or past the tree. */
export class WotsLeafReused extends PopcornError {
  constructor(
    readonly leaf: number,
    readonly nextLeaf: number,
  ) {
    super(
      leaf >= WOTS_LEAVES
        ? `WOTS tree exhausted: leaf ${leaf} >= ${WOTS_LEAVES}; rotate the owner (ownerRotate) before the last leaf`
        : `WOTS leaf ${leaf} was already used by this signer (next unused leaf: ${nextLeaf}); one-time keys must never sign twice`,
    );
  }
}

export interface HybridSignerOptions {
  /** The owner's ECDSA key (hex private key) or a local account that can sign a raw hash. */
  ecdsa: Hex | LocalAccount;
  /** The WOTS+ tree: its seeds (regenerated, ~7 s) or an already generated tree. */
  wots: { skSeed: Hex; pubSeed: Hex } | WotsTree;
  /** Persistent "next leaf" (fileLeafStore). REQUIRED: run ONE signer per key, from one process; in-memory (memoryLeafStore) for tests only. */
  store?: LeafStore;
  /** Roots of trees this owner used before: ownerAction refuses to rotate to any of them (a reused tree reuses spent leaves). */
  retiredRoots?: Hex[];
}

export interface SignedOwnerTx {
  tx: FrameTx;
  /** The WOTS leaf this signature consumed. */
  leaf: number;
  /** The signature hash both signatures cover. */
  sigHash: Hex;
}

export interface HybridSigner {
  /** The owner's ECDSA address. */
  readonly address: Address;
  readonly wotsRoot: Hex;
  readonly wotsPubSeed: Hex;
  readonly retiredRoots: readonly Hex[];
  /** What to pass the factory / deployRule as `owner`. */
  ownerInit(): OwnerInit;
  /** The next unused leaf (this signer's own record; ownerAction also honours the chain's wotsIndex). */
  nextLeaf(): number;
  /**
   * Signs the owner entries (the LAST two) of `tx` with ECDSA and WOTS+. Consumes a leaf: `max(nextLeaf, minLeaf)`, or the
   * explicit `leaf` (which must be >= nextLeaf, else WotsLeafReused). The store is updated BEFORE the signature is returned.
   */
  sign(tx: FrameTx, opts?: { minLeaf?: number; leaf?: number }): Promise<SignedOwnerTx>;
}

const isTree = (w: HybridSignerOptions["wots"]): w is WotsTree => "levels" in w;

export function hybridSigner(o: HybridSignerOptions): HybridSigner {
  const account = typeof o.ecdsa === "string" ? privateKeyToAccount(o.ecdsa) : o.ecdsa;
  if (typeof account.sign !== "function") throw new PopcornError("hybridSigner: the ECDSA account must be able to sign a raw hash (a local account)");
  const tree = isTree(o.wots) ? o.wots : wotsKeygen(o.wots.skSeed, o.wots.pubSeed);
  if (!o.store) {
    throw new PopcornError("hybridSigner: pass a persistent `store` (fileLeafStore(path)); an in-memory counter forgets spent leaves on restart. Tests: memoryLeafStore()");
  }
  const store = o.store;
  // Self-check before anything is deployed or signed: the tree must reproduce its own root, and a signature at the first and the
  // LAST leaf (path of all ones) must verify, so a mistyped seed or a broken key file cannot lock the owner out.
  if (wotsVerify(tree.root, tree.pubSeed, ZERO32, wotsSign(tree, ZERO32, 0)) !== true || wotsVerify(tree.root, tree.pubSeed, `0x${"ab".repeat(32)}`, wotsSign(tree, `0x${"ab".repeat(32)}`, WOTS_LEAVES - 1)) !== true) {
    throw new PopcornError("hybridSigner: WOTS tree failed its self-check (sign + verify at leaves 0 and 1023)");
  }
  if (BigInt(tree.pubSeed) === 0n) throw new PopcornError("hybridSigner: pubSeed must be non-zero");
  return {
    address: account.address,
    wotsRoot: tree.root,
    wotsPubSeed: tree.pubSeed,
    retiredRoots: o.retiredRoots ?? [],
    ownerInit: () => ({ ecdsa: account.address, wotsRoot: tree.root, wotsPubSeed: tree.pubSeed }),
    nextLeaf: () => store.get(),
    async sign(tx, opts = {}) {
      const next = store.get();
      const leaf = opts.leaf ?? Math.max(next, opts.minLeaf ?? 0);
      if (leaf < next || leaf >= WOTS_LEAVES) throw new WotsLeafReused(leaf, next);
      const n = tx.signatures.length;
      if (n < 2 || tx.signatures[n - 2]!.scheme !== SignatureScheme.ARBITRARY || tx.signatures[n - 1]!.scheme !== SignatureScheme.ARBITRARY) {
        throw new PopcornError("hybridSigner.sign: the last two signature entries must be the ARBITRARY owner placeholders (buildOwnerTx)");
      }
      // Spent from here on, even if anything below throws or the tx is never sent.
      store.set(leaf + 1);
      const sigHash = signatureHash(tx); // empty-msg entries' bytes are elided: placeholders and real signatures hash alike
      const ecdsa = parseSignature(await account.sign!({ hash: sigHash }));
      const v = 27 + (ecdsa.yParity ?? Number(ecdsa.v! - 27n));
      const ecdsaBytes = concat([pad(ecdsa.r, { size: 32 }), pad(ecdsa.s, { size: 32 }), toHex(v, { size: 1 })]);
      const signatures = [...tx.signatures];
      signatures[n - 2] = { ...signatures[n - 2]!, signature: ecdsaBytes };
      signatures[n - 1] = { ...signatures[n - 1]!, signature: wotsSign(tree, sigHash, leaf) };
      return { tx: { ...tx, signatures }, leaf, sigHash };
    },
  };
}

// ---------------------------------------------------------------- key generation + storage

/** What `generateHybridKeys` stores. SECRET: ecdsaKey and skSeed. Keep it out of git (keys/ is git-ignored here). */
export interface HybridKeyFile {
  version: 1;
  address: Address;
  ecdsaKey: Hex;
  skSeed: Hex;
  pubSeed: Hex;
  wotsRoot: Hex;
  /** Roots of trees retired by earlier rotations (add the old root here after a finalize). */
  retiredRoots?: Hex[];
}

/**
 * Creates a fresh owner: a random ECDSA key and a random WOTS+ tree (seeds), writes them (mode 0600, refusing to overwrite)
 * to `<path>` and the leaf counter to `<path>.leaves`, and returns the signer. Keygen takes ~7 s.
 *
 * STORAGE: `skSeed` regenerates every one-time key and `ecdsaKey` is the other half: whoever holds both is the owner. Prefer
 * keeping them on different machines (the ECDSA key in a hardware wallet / KMS and passing `ecdsa: account` to `hybridSigner`;
 * the WOTS seed offline), back up `skSeed` AND the leaf counter, and never restore an old counter file (a rolled-back counter
 * reuses leaves; ownerAction also reads the chain's wotsIndex, which protects the leaves already spent on chain but not
 * ones signed and dropped).
 */
export function generateHybridKeys(path: string): { signer: HybridSigner; file: HybridKeyFile } {
  if (existsSync(path)) throw new PopcornError(`${path} exists: refusing to overwrite owner keys`);
  const rand = () => generatePrivateKey();
  const ecdsaKey = rand();
  const skSeed = rand();
  const pubSeed = rand();
  const tree = wotsKeygen(skSeed, pubSeed);
  const address = privateKeyToAccount(ecdsaKey).address;
  const file: HybridKeyFile = { version: 1, address, ecdsaKey, skSeed, pubSeed, wotsRoot: tree.root };
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "wx", 0o600);
  writeSync(fd, JSON.stringify(file, null, 2) + "\n");
  fsyncSync(fd);
  closeSync(fd);
  fileLeafStore(`${path}.leaves`).set(0);
  return { signer: hybridSigner({ ecdsa: ecdsaKey, wots: tree, store: fileLeafStore(`${path}.leaves`) }), file };
}

/** Loads keys written by generateHybridKeys (regenerates the tree: ~7 s). The leaf counter is `<path>.leaves`. */
export function loadHybridSigner(path: string): HybridSigner {
  const f = JSON.parse(readFileSync(path, "utf8")) as HybridKeyFile;
  const signer = hybridSigner({ ecdsa: f.ecdsaKey, wots: { skSeed: f.skSeed, pubSeed: f.pubSeed }, store: fileLeafStore(`${path}.leaves`), retiredRoots: f.retiredRoots ?? [] });
  if (signer.wotsRoot !== f.wotsRoot) throw new PopcornError(`${path}: WOTS seeds do not regenerate the stored root`);
  return signer;
}

// ---------------------------------------------------------------- chain state

export interface OwnerState {
  /** address(0) = no owner (the owner path is off). */
  ecdsa: Address;
  /** The first leaf the next owner tx may use. */
  wotsIndex: number;
  wotsRoot: Hex;
  wotsPubSeed: Hex;
  /** A staged rotation (ownerRotate): the pending owner; ecdsa 0 = none. Its keys sign ONLY ownerFinalizeRotation(). */
  pending: { ecdsa: Address; wotsIndex: number; wotsRoot: Hex; wotsPubSeed: Hex };
  /** The OWNER_KEY sequence: the next owner tx's nonce_seq. 0 = the key was never used (the first use costs 20,000 more). */
  seq: bigint;
}

/** Reads the owner slots of a Core rule contract and the OWNER_KEY sequence from NONCE_MANAGER. */
export async function readOwnerState(ctx: PopcornContext, ruleContract: Address): Promise<OwnerState> {
  const base = BigInt(OWNER_BASE_SLOT);
  const slot = (n: bigint): Hex => pad(toHex(base + n), { size: 32 });
  const get = async (address: Address, s: Hex) => BigInt((await ctx.publicClient.getStorageAt({ address, slot: s })) ?? "0x0");
  const seqSlot = keccak256(concat([pad(getAddress(ruleContract), { size: 32 }), pad(toHex(OWNER_KEY), { size: 32 })]));
  const [s0, root, seed, p0, p1, p2, seq] = await Promise.all([get(ruleContract, slot(0n)), get(ruleContract, slot(1n)), get(ruleContract, slot(2n)), get(ruleContract, slot(3n)), get(ruleContract, slot(4n)), get(ruleContract, slot(5n)), get(NONCE_MANAGER, seqSlot)]);
  const addr = (v: bigint) => getAddress(pad(toHex(v & ((1n << 160n) - 1n)), { size: 20 }));
  return {
    pending: { ecdsa: addr(p0), wotsIndex: Number(p0 >> 160n), wotsRoot: pad(toHex(p1), { size: 32 }), wotsPubSeed: pad(toHex(p2), { size: 32 }) },
    ecdsa: getAddress(pad(toHex(s0 & ((1n << 160n) - 1n)), { size: 20 })),
    wotsIndex: Number(s0 >> 160n),
    wotsRoot: pad(toHex(root), { size: 32 }),
    wotsPubSeed: pad(toHex(seed), { size: 32 }),
    seq,
  };
}

// ---------------------------------------------------------------- ownerAction

export interface OwnerActionOptions {
  /** Mode 1 (caller-pays rule contracts): who pays, as for trigger(). */
  payer?: HashSigner | Address;
  payerGasLimit?: bigint;
  fees?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
  /** Frame 0 limit ceiling. Default: the prefix budget (100,000 public / 250,000 local) minus signature cost (200, +2,900 for an EOA payer)
   *  minus the payer frame's limit (mode 1): the cap counts ALL prefix VERIFY frames and signatures (ethrex transaction.rs). */
  verifyBudget?: bigint;
  /** Call frame limits (default 1,000,000 / 300,000: unused gas is refunded; the state limit covers ~3 fresh slots). */
  callGasLimit?: bigint;
  callStateGasLimit?: bigint;
  /** How many bump-gas values to try for a cheap sig hash (default 5000: ~40 µs each). */
  grind?: number;
  /** Send even if the simulated call frame reverts (the leaf is spent either way). Default false. */
  allowCallRevert?: boolean;
  via?: Parameters<typeof resolveVia>[1];
  /** Wait for inclusion (default true). */
  wait?: boolean;
  timeoutMs?: number;
}

export interface OwnerActionResult {
  hash: Hex;
  tx: FrameTx;
  leaf: number;
  /** WOTS hash steps of this sig hash (111 gas each). */
  steps: number;
  verifyGasLimit: bigint;
  /** Simulation of the signed tx just before it was sent. */
  simulation: SimulationResult;
  /** Present when `wait` (default): the receipt, with frame statuses. */
  receipt?: FrameTxReceipt | null;
  /** Frame statuses from the receipt: [VERIFY..., bump, call]. */
  frameStatuses?: string[];
  /** Did the owner call (the last frame) succeed? Only known with `wait`. */
  callSucceeded?: boolean;
  /** VERIFY (frame 0) gas used, from the simulation. */
  verifyGasUsed: bigint | null;
}

function ownerCodeName(rev: Hex | null): { code: number | null; name: string; reason: string } {
  if (!rev || size(rev) !== 32) return { code: null, name: "UNKNOWN", reason: "no Core revert data" };
  const code = Number(BigInt(rev));
  const e = CORE_ERRORS[code];
  return { code, name: e?.name ?? "UNKNOWN", reason: e?.check ?? "see contracts/core/LAYOUT.md" };
}

/**
 * Runs `call` (an encoded call of one of the rule contract logic's `onlyOwnerCall` functions) on the rule contract as its owner:
 *  1. reads the owner state and checks the signer IS the owner (ECDSA address + WOTS root);
 *  2. builds the tx and simulates it with zero signatures: Core must get as far as the ECDSA check (0x5f), which proves the
 *     shape, limits, fees and balance are right before any leaf is touched;
 *  3. grinds the bump frame's gas limit until the sig hash needs few WOTS hash steps, so VERIFY fits `verifyBudget`;
 *  4. signs ONCE (this spends a leaf), simulates the signed tx, refuses to send if it is invalid or the call reverts
 *     (unless allowCallRevert), sends the same bytes, and watches it.
 * Rule-pays rule contracts pay for it from their own balance (`payer` not allowed); caller-pays rule contracts need `payer`.
 */
export async function ownerAction(ctx: PopcornContext, ruleContractAddr: Address, call: Hex, signer: HybridSigner, o: OwnerActionOptions = {}): Promise<OwnerActionResult> {
  const ruleContract = await readRuleContract(ctx, ruleContractAddr);
  const a = ruleContract.args;
  const sp = a.mode === 1;
  if (!ruleContract.core.selectors.owner) throw new PopcornError(`rule contract ${ruleContract.address} runs Core ${ruleContract.core.version}, which has no owner path (v1.4+)`);
  if (sp && o.payer === undefined) throw new PayerRequired(ruleContract.address);
  if (!sp && o.payer !== undefined) throw new PopcornError("rule-pays rule contracts pay for their own owner txs: payer applies to caller-pays rule contracts only");
  const state = await readOwnerState(ctx, ruleContract.address);
  if (state.ecdsa === "0x0000000000000000000000000000000000000000") throw new PopcornError(`rule contract ${ruleContract.address} has no owner (deployed without one)`);
  const sel = call.slice(0, 10).toLowerCase();
  const finalize = sel === SEL_FINALIZE;
  // ownerFinalizeRotation() is verified by Core against the PENDING keys; every other call against the active ones
  const keys = finalize ? state.pending : { ecdsa: state.ecdsa, wotsIndex: state.wotsIndex, wotsRoot: state.wotsRoot, wotsPubSeed: state.wotsPubSeed };
  if (finalize && keys.ecdsa === "0x0000000000000000000000000000000000000000") throw new PopcornError("no rotation is staged (ownerRotate first)");
  if (getAddress(keys.ecdsa) !== getAddress(signer.address) || keys.wotsRoot !== signer.wotsRoot || keys.wotsPubSeed !== signer.wotsPubSeed) {
    throw new PopcornError(
      `signer is not this rule contract's ${finalize ? "PENDING" : "active"} owner: rule contract has ecdsa ${keys.ecdsa} root ${keys.wotsRoot} seed ${keys.wotsPubSeed}, signer ${signer.address} / ${signer.wotsRoot} / ${signer.wotsPubSeed} (nothing was signed)`,
    );
  }
  if (sel === SEL_ROTATE) {
    // never rotate to a tree whose leaves may be spent (the active one, or one this owner retired)
    const newRoot = `0x${call.slice(2 + 8 + 64, 2 + 8 + 128)}`.toLowerCase();
    if (newRoot === state.wotsRoot.toLowerCase() || signer.retiredRoots.some((r) => r.toLowerCase() === newRoot)) {
      throw new PopcornError(`ownerRotate to ${newRoot}: that tree is active or was used before; use a freshly generated one`);
    }
  }
  const effNext = Math.max(signer.nextLeaf(), keys.wotsIndex);
  if (effNext >= WOTS_LEAVES - RESERVED_ROTATION_LEAVES && sel !== SEL_ROTATE && sel !== SEL_FINALIZE && sel !== SEL_CANCEL_ROTATION) {
    throw new PopcornError(`WOTS leaf ${effNext} is within the last ${RESERVED_ROTATION_LEAVES}: kept for ownerRotate / ownerFinalizeRotation only; rotate to a fresh tree`);
  }
  const payerAddr: Address | null = o.payer === undefined ? null : getAddress(typeof o.payer === "string" ? o.payer : o.payer.address);
  const payerSigner: HashSigner | null = o.payer !== undefined && typeof o.payer !== "string" ? o.payer : null;
  if (payerAddr && !payerSigner) {
    const code = await ctx.publicClient.getCode({ address: payerAddr });
    if (!code || code === "0x") throw new PopcornError(`payer ${payerAddr} has no code: an EOA payer must be passed as an account that signs`);
  }

  // fees (rule-pays: within the rule contract's caps; caller-pays: the payer's)
  const [block, tipHex] = await Promise.all([ctx.publicClient.getBlock({ blockTag: "latest" }), ctx.rpc<Hex>("eth_maxPriorityFeePerGas", []).catch(() => "0x3b9aca00" as Hex)]);
  const baseFee = block.baseFeePerGas ?? 0n;
  const min = (x: bigint, y: bigint) => (x < y ? x : y);
  let tip = o.fees?.maxPriorityFeePerGas ?? (sp ? (ctx.fees.priorityFee ?? BigInt(tipHex)) : min(a.maxPriorityFeePerGas, ctx.fees.priorityFee ?? BigInt(tipHex)));
  const maxFee = o.fees?.maxFeePerGas ?? (sp ? baseFee * ctx.fees.baseFeeMultiplier + tip : min(a.maxFeePerGas, baseFee * ctx.fees.baseFeeMultiplier + tip));
  if (o.fees?.maxPriorityFeePerGas === undefined && tip > maxFee) tip = maxFee;

  const payerGas = o.payerGasLimit ?? DEFAULT_PAYER_GAS_LIMIT;
  const prefixTotal = ctx.devnet.name === "local" ? 250_000n : 100_000n;
  const sigCost = 200n + (payerSigner ? 2_900n : 0n); // two ARBITRARY entries (+ the EOA payer's placeholder 100 and SECP256K1 2,800)
  const budget = o.verifyBudget ?? prefixTotal - sigCost - (sp ? payerGas : 0n);
  const base = {
    ruleContract: ruleContract.address,
    mode: a.mode,
    chainId: ctx.chainId,
    seq: state.seq,
    call,
    callGasLimit: o.callGasLimit ?? 1_000_000n,
    callStateGasLimit: o.callStateGasLimit ?? 300_000n,
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: tip,
    ...(payerAddr ? { payer: payerAddr, payerKind: (payerSigner ? "eoa" : "contract") as "eoa" | "contract", payerGasLimit: o.payerGasLimit ?? DEFAULT_PAYER_GAS_LIMIT } : {}),
  };
  const topts = { ...ctx.transport, devnet: ctx.devnet };
  const finish = async (tx: FrameTx): Promise<FrameTx> => (payerSigner ? signSecp256k1Entry(tx, 1, payerSigner) : tx);

  // 2. preflight with zero signatures
  // mode 0: the rule contract's VERIFY pays the key's first use (+20,000); mode 1: the payer's frame does
  const firstUse = state.seq === 0n && !sp;
  const verifyCost = (steps: number) => OWNER_VERIFY_BASE_GAS + WOTS_STEP_GAS * BigInt(steps) + (firstUse ? KEY_FIRST_USE_GAS : 0n);
  const margin = 2_000n;
  const limit = budget < OWNER_LIMITS.maxVerifyGas ? budget : OWNER_LIMITS.maxVerifyGas;
  const probe = await finish(buildOwnerTx({ ...base, verifyGasLimit: limit, bumpGasLimit: OWNER_LIMITS.minBumpGas }));
  const pre = await simulateFrameTransaction(serializeFrameTx(probe), { ...topts, trace: false });
  const pc = ownerCodeName(pre.revertData);
  if (pc.code !== 0x5f && pc.code !== 0x6a && !(pre.executionStatus !== null)) { // zero signatures fail at the ECDSA checks (0x6a, 0x5f): everything before them is fine
    if (pc.code === null && /balance|funds/i.test(pre.executionError ?? "")) throw new RuleContractNotReady(ruleContract.address, null, "INSUFFICIENT_BALANCE", pre.executionError ?? "the payer cannot cover max_cost");
    throw new RuleContractNotReady(ruleContract.address, pc.code, pc.name, pc.code === null ? (pre.executionError ?? "owner tx invalid") : pc.reason);
  }

  // 3. grind: the VERIFY limit is FIXED at the budget (so it does not change the hash); vary the bump frame's gas limit
  //    (70,001 values) and then the call frame's gas limit until the sig hash needs few enough WOTS steps.
  if (verifyCost(WOTS_MIN_STEPS) + margin > limit) {
    throw new PopcornError(
      `an owner tx cannot fit a VERIFY budget of ${limit}: even the cheapest signature hash (${WOTS_MIN_STEPS} WOTS steps) needs ${verifyCost(WOTS_MIN_STEPS) + margin}` +
        `${sp ? ` (mode 1: the payer frame's ${payerGas} and ${sigCost} of signature cost count against the 100,000 prefix cap)` : ""}. Use the local devnet (250,000) or a higher budget.`,
    );
  }
  const attempts = o.grind ?? 200_000;
  const nb = Number(OWNER_LIMITS.maxBumpGas - OWNER_LIMITS.minBumpGas) + 1;
  const callGas0 = o.callGasLimit ?? 1_000_000n;
  let chosen: { tx: FrameTx; steps: number } | null = null;
  let bestSteps = Infinity;
  for (let k = 0; k < attempts; k++) {
    const tx = buildOwnerTx({ ...base, callGasLimit: callGas0 + BigInt(Math.floor(k / nb)), verifyGasLimit: limit, bumpGasLimit: OWNER_LIMITS.minBumpGas + BigInt(k % nb) });
    const steps = wotsSteps(signatureHash(tx));
    if (steps < bestSteps) bestSteps = steps;
    if (verifyCost(steps) + margin <= limit) {
      chosen = { tx, steps };
      break;
    }
  }
  if (!chosen) {
    throw new PopcornError(`no cheap-enough signature hash in ${attempts} tries for a VERIFY budget of ${limit} (best needs ${verifyCost(bestSteps) + margin}); raise verifyBudget`);
  }

  // 4. sign once, simulate, send
  const unsigned = await finish(chosen.tx);
  const { tx: signedOwner, leaf, sigHash } = await signer.sign(unsigned, { minLeaf: keys.wotsIndex });
  void sigHash;
  const signed = await finish(signedOwner); // an EOA payer's entry is elided from the hash but re-sign for a clean tx
  assertValidFrameTx(signed);
  const raw = serializeFrameTx(signed);
  const sim = await simulateFrameTransaction(raw, { ...topts, trace: false });
  if (sim.executionStatus === null) {
    const c = ownerCodeName(sim.revertData);
    throw new RuleContractNotReady(ruleContract.address, c.code, c.name, `${c.code === null ? (sim.executionError ?? c.reason) : c.reason} (WOTS leaf ${leaf} is spent; nothing was sent)`);
  }
  const frames = sim.frames ?? [];
  const callOk = frames.length ? frames[frames.length - 1]!.succeeded : sim.executionStatus === "success";
  if (!callOk && !o.allowCallRevert) {
    throw new RuleContractNotReady(ruleContract.address, null, "OWNER_CALL_REVERTS", `the owner call reverts in simulation (revert data ${sim.revertData ?? "none"}); WOTS leaf ${leaf} is spent, nothing was sent`);
  }
  const via = await resolveVia(ctx, o.via);
  let hash: Hex = "0x";
  // The sidecar can still hold the previous owner tx ("nonce key ... already held by pending transaction") for a few
  // seconds after it was included; resending the SAME bytes is safe (no new signature), so retry.
  for (let attempt = 0; ; attempt++) {
    try {
      hash = await sendFrameTransaction(raw, { ...topts, via });
      break;
    } catch (e) {
      if (e instanceof RpcError && /already held by pending/i.test(e.rpcMessage) && attempt < 30) {
        await new Promise((r) => setTimeout(r, 2_000));
        continue;
      }
      if (e instanceof RpcError) throw new NotAdmitted(via, `[${e.code}] ${e.rpcMessage} (WOTS leaf ${leaf} is spent)`, { cause: e });
      throw e;
    }
  }
  const result: OwnerActionResult = { hash, tx: signed, leaf, steps: chosen.steps, verifyGasLimit: chosen.tx.frames[0]!.gasLimit, simulation: sim, verifyGasUsed: frames[0]?.gasUsed ?? null };
  if (o.wait ?? true) {
    const st = await watch(ctx, hash, { timeoutMs: o.timeoutMs ?? 180_000 });
    result.receipt = st.state === "included" ? await getReceipt(hash, topts) : null;
    if (result.receipt) {
      result.frameStatuses = result.receipt.frameReceipts.map((f) => f.status);
      result.callSucceeded = result.receipt.frameReceipts[result.receipt.frameReceipts.length - 1]?.status === "success";
    }
  }
  return result;
}
