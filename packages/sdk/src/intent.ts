// Signed intents: "this key signed this exact trigger". Off-chain side of contracts/src/signers/*.
//
// THE SIGNED DIGEST (contracts/src/signers/IntentDigest.sol; this file must match it bit for bit, the Foundry test reads the
// vectors this module generated):
//   context    = abi.encode(uint256 ruleId, uint256 ruleEpoch, bytes32 popArgsHash)        popArgsHash = keccak256(triggerData)
//   domainSep  = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("Popcorn Signed Intent"), keccak256("1"), chainId, ruleContract))
//   structHash = keccak256(abi.encode(INTENT_TYPEHASH, ruleId, ruleEpoch, popArgsHash))
//   digest     = keccak256(0x1901 ++ domainSep ++ structHash)
// It is EIP-712 typed data, so a wallet's eth_signTypedData_v4 over `intentTypedData(...)` signs the same digest.
// Attested facts sign the PopcornAttestation struct (adds `statement`); see attestationDigest.
//
// This file: digest and context helpers, params/witness encoders for every predicate, signers (ECDSA, P-256, WebAuthn assertion
// builder, WOTS+ with one-time-leaf protection), and the params blob a SignedIntentCounter-style rule contract reads.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha2";
import { concat, encodeAbiParameters, getAddress, hashTypedData, hexToBytes, isAddress, keccak256, numberToHex, pad, size, stringToBytes, toBytes, toHex, type Address, type Hex } from "viem";
import { PopcornError } from "./errors.ts";
import { WOTS_LEAVES, wotsKeygen, wotsSign, wotsSteps, wotsVerify, type WotsTree } from "./wots.ts";

// ---------------------------------------------------------------- digest

export const INTENT_NAME = "Popcorn Signed Intent";
export const INTENT_VERSION = "1";
const DOMAIN_TYPEHASH = keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
const INTENT_TYPEHASH = keccak256(toHex("PopcornIntent(uint256 ruleId,uint256 ruleEpoch,bytes32 popArgsHash)"));
const ATTEST_TYPEHASH = keccak256(toHex("PopcornAttestation(bytes32 statement,uint256 ruleId,uint256 ruleEpoch,bytes32 popArgsHash)"));

export interface IntentFields {
  /** Which rule of the rule contract (SignedIntentCondition._ruleId). Single-rule rule contracts: 0. */
  ruleId: bigint | number;
  /** The rule's epoch the trigger is signed for (what the rule contract reads from its own storage; starts at 0). */
  ruleEpoch: bigint | number;
  /** The trigger's triggerData (the exact bytes; hashed into the digest). */
  triggerData: Hex;
}
export interface IntentBinding extends IntentFields {
  chainId: bigint | number;
  /** The rule contract the trigger is for (the predicate sees it as msg.sender). */
  ruleContract: Address;
}

const u = (x: bigint | number): bigint => BigInt(x);

/** abi.encode(ruleId, ruleEpoch, keccak256(triggerData)): the `context` the rule contract hands to the predicate. */
export function intentContext(f: IntentFields): Hex {
  return encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }], [u(f.ruleId), u(f.ruleEpoch), keccak256(f.triggerData)]);
}

export function domainSeparator(chainId: bigint | number, ruleContract: Address): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [DOMAIN_TYPEHASH, keccak256(toHex(INTENT_NAME)), keccak256(toHex(INTENT_VERSION)), u(chainId), ruleContract],
    ),
  );
}

/** The 32 bytes every signer signs (IntentDigest.intentDigest). */
export function intentDigest(b: IntentBinding): Hex {
  const structHash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }], [INTENT_TYPEHASH, u(b.ruleId), u(b.ruleEpoch), keccak256(b.triggerData)]));
  return keccak256(concat(["0x1901", domainSeparator(b.chainId, b.ruleContract), structHash]));
}

/** The digest k-of-n attestors sign (IntentDigest.attestationDigest): the intent plus the statement fixed in the params. */
export function attestationDigest(b: IntentBinding & { statement: Hex }): Hex {
  const structHash = keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }], [ATTEST_TYPEHASH, b.statement, u(b.ruleId), u(b.ruleEpoch), keccak256(b.triggerData)]),
  );
  return keccak256(concat(["0x1901", domainSeparator(b.chainId, b.ruleContract), structHash]));
}

/** viem typed data for wallets (eth_signTypedData_v4): hashTypedData(intentTypedData(b)) === intentDigest(b). */
export function intentTypedData(b: IntentBinding) {
  return {
    domain: { name: INTENT_NAME, version: INTENT_VERSION, chainId: u(b.chainId), verifyingContract: b.ruleContract },
    types: { PopcornIntent: [{ name: "ruleId", type: "uint256" }, { name: "ruleEpoch", type: "uint256" }, { name: "popArgsHash", type: "bytes32" }] },
    primaryType: "PopcornIntent" as const,
    message: { ruleId: u(b.ruleId), ruleEpoch: u(b.ruleEpoch), popArgsHash: keccak256(b.triggerData) },
  };
}
export const hashIntentTypedData = (b: IntentBinding): Hex => hashTypedData(intentTypedData(b));

export function attestationTypedData(b: IntentBinding & { statement: Hex }) {
  return {
    domain: { name: INTENT_NAME, version: INTENT_VERSION, chainId: u(b.chainId), verifyingContract: b.ruleContract },
    types: { PopcornAttestation: [{ name: "statement", type: "bytes32" }, { name: "ruleId", type: "uint256" }, { name: "ruleEpoch", type: "uint256" }, { name: "popArgsHash", type: "bytes32" }] },
    primaryType: "PopcornAttestation" as const,
    message: { statement: b.statement, ruleId: u(b.ruleId), ruleEpoch: u(b.ruleEpoch), popArgsHash: keccak256(b.triggerData) },
  };
}

// ---------------------------------------------------------------- scheme ids and key encodings (contracts/src/signers/lib/Schemes.sol)

export const Scheme = { ECDSA: 0, P256: 1, WEBAUTHN: 2, WOTS: 3 } as const;
export type SchemeId = (typeof Scheme)[keyof typeof Scheme];
export const KEY_LENGTH: Record<SchemeId, number> = { 0: 20, 1: 64, 2: 128, 3: 160 };
export const WOTS_WITNESS_BYTES = 32 + 32 * 77; // salt + 67 chains + 10 path nodes = 2,496
export const MAX_SIGNERS = 16;

export class IntentError extends PopcornError {}
/** A one-time (WOTS+, XMSS/LMS-style) or few-time (FORS) key index would sign a second digest. */
export class OneTimeKeyReused extends IntentError {
  constructor(
    readonly index: number,
    readonly scheme: string,
  ) {
    super(`${scheme} key index ${index} already signed a different digest; one-time keys must never sign twice (advance the rule epoch, or use a fresh key)`);
  }
}
/** A few-time key reached its signature bound. */
/** The key is already bound to another (chainId, rule contract, ruleId): a one-time key must serve exactly one binding. */
export class KeyBoundElsewhere extends IntentError {
  constructor(
    readonly keyId: string,
    readonly bound: string,
    readonly requested: string,
  ) {
    super(`key ${keyId.slice(0, 12)}… is bound to ${bound}; refusing to sign for ${requested} (one tree, one rule contract, one rule: otherwise two messages could land on one leaf)`);
  }
}
/** The best salt found still needs more verifier work than the declared budget: nothing was signed and no leaf was consumed. */
export class StepBudgetExceeded extends IntentError {
  constructor(
    readonly steps: number,
    readonly maxSteps: number,
    readonly tries: number,
  ) {
    super(`best of ${tries} salts needs ${steps} hash steps, over the budget of ${maxSteps}: nothing was signed and no leaf was used (raise maxTries or the budget)`);
  }
}
/** The key's binding in the usage store. */
export interface IntentKeyBinding {
  chainId: bigint | number;
  ruleContract: Address;
  ruleId: bigint | number;
}
export const bindingId = (b: IntentKeyBinding): string => `${BigInt(b.chainId)}:${b.ruleContract.toLowerCase()}:${BigInt(b.ruleId)}`;
export class SignatureBudgetExhausted extends IntentError {
  constructor(
    readonly used: number,
    readonly max: number,
    scheme: string,
  ) {
    super(`${scheme}: ${used} of ${max} signatures used; this key must not sign again`);
  }
}

const addr20 = (a: Address): Hex => {
  if (!isAddress(a)) throw new IntentError(`not an address: ${a}`);
  return getAddress(a).toLowerCase() as Hex;
};
const word = (n: bigint | number | Hex): Hex => (typeof n === "string" ? pad(n, { size: 32 }) : pad(numberToHex(n), { size: 32 }));
const hex32 = (h: Hex, what: string): Hex => {
  if (size(h) !== 32) throw new IntentError(`${what} must be 32 bytes`);
  return h;
};

export const ecdsaParams = (signer: Address): Hex => addr20(signer);
export const p256Params = (k: { x: Hex; y: Hex }): Hex => concat([word(k.x), word(k.y)]);
/** sha256 of bytes, a 0x-hex string (as bytes) or any other string (as UTF-8). */
export const sha256Hex = (data: Uint8Array | Hex | string): Hex =>
  toHex(sha256(data instanceof Uint8Array ? data : typeof data === "string" && data.startsWith("0x") ? hexToBytes(data as Hex) : stringToBytes(data)));
/**
 * WebAuthnSigner key blob. A non-zero rpIdHash is REQUIRED (pass `rpId` or `rpIdHash`): a zero hash would accept an assertion for any relying party.
 * `allowAnyRp: true` is the explicit opt-out. The contract checks the rpIdHash in authenticatorData, the challenge, the type, UP (and UV when asked);
 * it does NOT check the assertion's `origin` or `crossOrigin` (they are inside clientDataJSON, which is not parsed).
 */
export function webauthnParams(k: { x: Hex; y: Hex; rpId?: string; rpIdHash?: Hex; requireUV?: boolean; allowAnyRp?: boolean }): Hex {
  const rp = k.rpIdHash ?? (k.rpId !== undefined ? sha256Hex(stringToBytes(k.rpId)) : word(0));
  if (BigInt(rp) === 0n && !k.allowAnyRp) throw new IntentError("webauthnParams: pass rpId or rpIdHash (a zero rpIdHash accepts any relying party); allowAnyRp: true opts out explicitly");
  return concat([word(k.x), word(k.y), hex32(rp, "rpIdHash"), word(k.requireUV ? 1 : 0)]);
}
export interface WotsKey {
  root: Hex;
  pubSeed: Hex;
  /** The ruleEpoch that maps to leaf 0 (leaf = ruleEpoch - firstEpoch). */
  firstEpoch: bigint | number;
  /** The chain and the rule the key is bound to ON CHAIN: the predicate refuses any other (so two rules never share a leaf). */
  chainId: bigint | number;
  ruleId: bigint | number;
}
export const wotsParams = (k: WotsKey): Hex => concat([hex32(k.root, "root"), hex32(k.pubSeed, "pubSeed"), word(k.firstEpoch), word(k.chainId), word(k.ruleId)]);
/** Hybrid ECDSA + WOTS+ (HybridEcdsaWotsSigner): ecdsa address (20) ++ WOTS key (96). */
export const hybridEcdsaWotsParams = (signer: Address, k: WotsKey): Hex => concat([ecdsaParams(signer), wotsParams(k)]);
/** Generic hybrid (HybridEcdsaSigner): ecdsa address (20) ++ inner scheme predicate (20) ++ inner params. */
export const hybridEcdsaParams = (signer: Address, innerSigner: Address, innerParams: Hex): Hex => concat([ecdsaParams(signer), addr20(innerSigner), innerParams]);

// ---------------------------------------------------------------- multisig and attested facts

export interface MultisigSigner {
  scheme: SchemeId;
  /** The scheme's key encoding (ecdsaParams / p256Params / webauthnParams / wotsParams). */
  key: Hex;
}
/** MultisigSigner params. Refuses: threshold 0 or above n, n above 16, a wrong key length, duplicate keys. */
export function multisigParams(threshold: number, signers: MultisigSigner[]): Hex {
  const n = signers.length;
  if (threshold < 1 || threshold > n) throw new IntentError(`threshold ${threshold} must be between 1 and ${n}`);
  if (n > MAX_SIGNERS) throw new IntentError(`at most ${MAX_SIGNERS} signers (got ${n})`);
  const seen = new Set<string>();
  const parts: Hex[] = [toHex(threshold, { size: 1 }), toHex(n, { size: 1 })];
  for (const s of signers) {
    if (size(s.key) !== KEY_LENGTH[s.scheme]) throw new IntentError(`scheme ${s.scheme} key must be ${KEY_LENGTH[s.scheme]} bytes (got ${size(s.key)})`);
    const id = `${s.scheme}:${s.key.toLowerCase()}`;
    if (seen.has(id)) throw new IntentError("duplicate signer key: one key must not fill two slots");
    seen.add(id);
    parts.push(toHex(s.scheme, { size: 1 }), s.key);
  }
  return concat(parts);
}
/** MultisigSigner witness: exactly `threshold` entries, signer indexes strictly increasing. `sigs` may be given in any order. */
export function multisigWitness(threshold: number, sigs: { index: number; sig: Hex }[]): Hex {
  if (sigs.length !== threshold) throw new IntentError(`exactly ${threshold} signatures are required (got ${sigs.length})`);
  const sorted = [...sigs].sort((a, b) => a.index - b.index);
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.index === sorted[i - 1]!.index) throw new IntentError("two signatures for one signer slot");
  return concat([toHex(threshold, { size: 1 }), ...sorted.map((s) => concat([toHex(s.index, { size: 1 }), toHex(size(s.sig), { size: 2 }), s.sig]))]);
}
/** AttestedFactSigner params. Refuses a bad k/n, zero or duplicate attestors. */
export function attestedParams(statement: Hex, k: number, attestors: Address[]): Hex {
  const n = attestors.length;
  if (k < 1 || k > n || n > MAX_SIGNERS) throw new IntentError(`need 1 <= k <= n <= ${MAX_SIGNERS} (k=${k}, n=${n})`);
  const set = new Set(attestors.map((a) => a.toLowerCase()));
  if (set.size !== n) throw new IntentError("duplicate attestor");
  return concat([hex32(statement, "statement"), toHex(k, { size: 1 }), toHex(n, { size: 1 }), ...attestors.map(addr20)]);
}
/** AttestedFactSigner witness: k entries (attestor index, 65-byte signature), indexes strictly increasing. */
export function attestedWitness(k: number, sigs: { index: number; sig: Hex }[]): Hex {
  if (sigs.length !== k) throw new IntentError(`exactly ${k} attestations are required (got ${sigs.length})`);
  const sorted = [...sigs].sort((a, b) => a.index - b.index);
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.index === sorted[i - 1]!.index) throw new IntentError("two attestations from one attestor");
  return concat(sorted.map((s) => concat([toHex(s.index, { size: 1 }), s.sig])));
}

// ---------------------------------------------------------------- ECDSA

/** Anything that signs a 32-byte hash and returns the 65-byte r ++ s ++ v (viem's LocalAccount.sign does). */
export interface HashSignerLike {
  sign: (a: { hash: Hex }) => Promise<Hex>;
}
const N_K1 = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
/** The witness for EcdsaSigner (and the ECDSA half of every hybrid): r ++ s ++ v with v in {27, 28} and low s. */
export async function signEcdsaDigest(signer: HashSignerLike, digest: Hex): Promise<Hex> {
  const sig = await signer.sign({ hash: digest });
  if (size(sig) !== 65) throw new IntentError("signer returned a signature that is not 65 bytes");
  let v = Number(BigInt("0x" + sig.slice(-2)));
  if (v < 27) v += 27;
  const s = BigInt(`0x${sig.slice(66, 130)}`);
  if (s > N_K1 / 2n) throw new IntentError("signer returned a high-s signature (the predicate refuses it)");
  return concat([`0x${sig.slice(2, 130)}`, toHex(v, { size: 1 })]);
}
export const signEcdsaIntent = (signer: HashSignerLike, b: IntentBinding): Promise<Hex> => signEcdsaDigest(signer, intentDigest(b));
export const signAttestation = (signer: HashSignerLike, b: IntentBinding & { statement: Hex }): Promise<Hex> => signEcdsaDigest(signer, attestationDigest(b));

// ---------------------------------------------------------------- P-256 and WebAuthn

export interface P256Key {
  /** Secret scalar (32 bytes). Treat like a private key. */
  privateKey: Hex;
  x: Hex;
  y: Hex;
}
export function p256Keygen(privateKey?: Hex): P256Key {
  const sk = privateKey ? hexToBytes(privateKey) : p256.utils.randomPrivateKey();
  const pub = p256.getPublicKey(sk, false);
  return { privateKey: toHex(sk), x: toHex(pub.slice(1, 33)), y: toHex(pub.slice(33, 65)) };
}
/** r ++ s of a low-s signature over a 32-byte hash (no prehash: the hash is signed as is, like the precompile verifies it). */
export function p256SignHash(privateKey: Hex, hash: Hex): Hex {
  const sig = p256.sign(hexToBytes(hash), hexToBytes(privateKey), { lowS: true, prehash: false });
  return concat([word(sig.r), word(sig.s)]);
}
/** Witness for P256Signer: r ++ s over the digest. */
export const signP256Intent = (key: Pick<P256Key, "privateKey">, b: IntentBinding): Hex => p256SignHash(key.privateKey, intentDigest(b));
export const signP256Digest = (key: Pick<P256Key, "privateKey">, digest: Hex): Hex => p256SignHash(key.privateKey, digest);

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

export interface WebAuthnAssertionOptions {
  rpId?: string;
  origin?: string;
  /** User verified (UV flag 0x04). Default true. */
  userVerified?: boolean;
  /** User present (UP flag 0x01). Default true. */
  userPresent?: boolean;
  signCount?: number;
  /** Test hooks: replace the clientDataJSON the authenticator "signs" (e.g. malformed JSON) or the offsets reported. */
  clientDataJSON?: string;
  typeIndex?: number;
  challengeIndex?: number;
}
/**
 * What a passkey returns for navigator.credentials.get({ challenge: digest }), built locally with a P-256 key for tests and tools:
 * authenticatorData, clientDataJSON, a low-s signature over sha256(authenticatorData ++ sha256(clientDataJSON)), and the WebAuthnSigner witness
 * (r ++ s ++ typeIndex ++ challengeIndex ++ authLength ++ authenticatorData ++ clientDataJSON).
 */
export function buildWebAuthnAssertion(key: Pick<P256Key, "privateKey">, digest: Hex, o: WebAuthnAssertionOptions = {}) {
  const rpId = o.rpId ?? "popcorn.example";
  const flags = (o.userPresent === false ? 0 : 1) | (o.userVerified === false ? 0 : 4);
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, o.signCount ?? 1);
  const authenticatorData = concat([sha256Hex(stringToBytes(rpId)), toHex(flags, { size: 1 }), toHex(counter)]);
  const clientDataJSON = o.clientDataJSON ?? JSON.stringify({ type: "webauthn.get", challenge: b64url(hexToBytes(digest)), origin: o.origin ?? `https://${rpId}`, crossOrigin: false });
  const typeIndex = o.typeIndex ?? clientDataJSON.indexOf('"type":"webauthn.get"');
  const challengeIndex = o.challengeIndex ?? clientDataJSON.indexOf('"challenge":"');
  const message = sha256Hex(concat([authenticatorData, sha256Hex(stringToBytes(clientDataJSON))]));
  const signature = p256SignHash(key.privateKey, message);
  const witness = concat([signature, toHex(Math.max(typeIndex, 0), { size: 2 }), toHex(Math.max(challengeIndex, 0), { size: 2 }), toHex(size(authenticatorData), { size: 2 }), authenticatorData, toHex(stringToBytes(clientDataJSON))]);
  return { authenticatorData, clientDataJSON, signature, witness, typeIndex, challengeIndex };
}

// ---------------------------------------------------------------- one-time key usage store

/** "Which digest (and which salt) did this key index sign?" Persist BEFORE a signature is returned. Values are `digest` or `digest:extra`. */
export interface UsageStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}
export const memoryUsageStore = (): UsageStore => {
  const m = new Map<string, string>();
  return { get: (i) => m.get(i), set: (i, d) => void m.set(i, d) };
}
/** File-backed store (fsync of file and directory, 0600), one JSON object { index: digest }. One signer per key. */
export function fileUsageStore(path: string): UsageStore {
  const read = (): Record<string, string> => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : {});
  return {
    get: (i) => read()[i],
    set: (i, d) => {
      const all = read();
      all[i] = d;
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      const fd = openSync(tmp, "w", 0o600);
      writeSync(fd, JSON.stringify(all) + "\n");
      fsyncSync(fd);
      closeSync(fd);
      renameSync(tmp, path);
      const dfd = openSync(dirname(path), "r");
      try {
        fsyncSync(dfd);
      } finally {
        closeSync(dfd);
      }
    },
  };
}

/**
 * Claims one leaf (key index) of key `keyId` for `digest`, for the binding (chainId, rule contract, ruleId). Throws:
 *  - KeyBoundElsewhere if the key already signed for another binding (one tree serves exactly one chain, rule contract and rule),
 *  - OneTimeKeyReused if this leaf already signed a DIFFERENT digest.
 * Returns the `extra` (a salt) recorded with the first claim, or records and returns `makeExtra()`: signing the same digest again must reuse the same salt,
 * because a one-time key that signs two different salted messages leaks chain values just like one that signs two digests.
 * `makeExtra` runs BEFORE anything is persisted, so it may throw (budget exceeded) without consuming the leaf or binding the key.
 */
export function claimLeaf(store: UsageStore, keyId: Hex, binding: IntentKeyBinding, leaf: number, digest: Hex, scheme: string, makeExtra: () => string = () => ""): string {
  const bid = bindingId(binding);
  const latchKey = `bound:${keyId.toLowerCase()}`;
  const bound = store.get(latchKey);
  if (bound !== undefined && bound !== bid) throw new KeyBoundElsewhere(keyId, bound, bid);
  const leafKey = `leaf:${keyId.toLowerCase()}:${bid}:${leaf}`;
  const prior = store.get(leafKey);
  if (prior !== undefined) {
    const [d, ...rest] = prior.split(":");
    if (d!.toLowerCase() !== digest.toLowerCase()) throw new OneTimeKeyReused(leaf, scheme);
    return rest.join(":");
  }
  const extra = makeExtra();
  if (bound === undefined) store.set(latchKey, bid);
  store.set(leafKey, extra ? `${digest}:${extra}` : digest);
  return extra;
}

// ---------------------------------------------------------------- WOTS+

/** Hash steps the verifier runs for a 32-byte message hash (the 64 digits and the 3 checksum digits), without BigInt: fast enough to grind millions of salts. */
export function wotsStepsOfHash(h: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < 32; i++) s += 30 - (h[i]! >> 4) - (h[i]! & 15);
  return s + 45 - (s >> 8) - ((s >> 4) & 15) - (s & 15);
}

/** Grinds a salt: the first of up to `maxTries` candidates with at most `targetSteps` steps, else the best seen. */
export function grindSalt(candidate: (i: number) => Hex, messageOf: (salt: Hex) => Hex, o: { maxTries: number; targetSteps: number }): { salt: Hex; steps: number; tries: number } {
  let best = candidate(0);
  let bestSteps = wotsStepsOfHash(hexToBytes(messageOf(best)));
  let tries = 1;
  while (bestSteps > o.targetSteps && tries < o.maxTries) {
    const s = candidate(tries++);
    const st = wotsStepsOfHash(hexToBytes(messageOf(s)));
    if (st < bestSteps) [best, bestSteps] = [s, st];
  }
  return { salt: best, steps: bestSteps, tries };
}

/** Salt-grinding budget of a hash-chain signer (WOTS+, XMSS, SPHINCS+): REQUIRED, so a signature that would not fit is never produced. */
export interface StepBudget {
  /**
   * The most verifier hash steps (about 117 gas each) the signature may need. The signer grinds salts until the message needs at most this many,
   * and THROWS StepBudgetExceeded, before consuming a leaf or binding the key, if `maxTries` salts (default 200,000, a few seconds) found none.
   * Gas model measured in a rule contract: VERIFY = fixed + 117 x steps, fixed about 49.8k for the inline WOTS+ trigger.
   * Random messages average 502 steps (minimum 360 over 20,000), so under the public 100k budget use about 375-390.
   */
  maxSteps: number;
  maxTries?: number;
}
export interface WotsIntentSignerOptions {
  /** The key tree (wotsKeygen). Its skSeed is secret. NEVER use the Core owner's WOTS+ tree here: the owner path and the intents would share leaves. */
  tree: WotsTree;
  /** The ruleEpoch that maps to leaf 0. Must match the params the rule contract was deployed with. */
  firstEpoch: bigint | number;
  /** The one (chainId, rule contract, ruleId) this tree serves. The signer refuses any other, and the on-chain key is bound to the same chain and rule. */
  binding: IntentKeyBinding;
  /** Which digest each leaf signed. REQUIRED. fileUsageStore(path) for real keys, memoryUsageStore() for tests. */
  store: UsageStore;
  budget: StepBudget;
}
export interface WotsIntentSigner {
  key: WotsKey;
  params: Hex;
  /**
   * WotsSigner witness for this intent: salt ++ chains ++ path (2,496 bytes). Refuses a leaf that signed another digest, another binding, and a
   * signature over budget. NOTE: a signed one-time intent must be EXECUTED: the leaf is spent when it is signed, so an unexecuted signature blocks
   * that epoch (the rule contract waits for exactly this epoch; skip it by signing and triggering the next intent for the same epoch is impossible).
   */
  sign(b: IntentBinding): Hex;
  signDigest(digest: Hex, ruleEpoch: bigint | number): Hex;
  /** Hash steps the verifier will run for this digest and salt (about 117 gas each). */
  stepsFor(digest: Hex, salt: Hex): number;
}
/** The on-chain key (and so the params) of a tree for a chain and rule: needs no rule contract address, so it can be computed before the rule contract is deployed. */
export const wotsIntentKey = (tree: WotsTree, firstEpoch: bigint | number, chainId: bigint | number, ruleId: bigint | number): WotsKey => ({ root: tree.root, pubSeed: tree.pubSeed, firstEpoch: BigInt(firstEpoch), chainId, ruleId });
export function assertBinding(bind: IntentKeyBinding, b: IntentBinding): void {
  if (bindingId(bind) !== bindingId(b)) throw new IntentError(`this signer is bound to ${bindingId(bind)}; asked to sign for ${bindingId(b)}`);
}
export function wotsIntentSigner(o: WotsIntentSignerOptions): WotsIntentSigner {
  if (!o.store) throw new IntentError("wotsIntentSigner: pass a `store` (fileUsageStore); an in-memory store forgets spent leaves on restart");
  if (!o.budget || !(o.budget.maxSteps > 0)) throw new IntentError("wotsIntentSigner: pass `budget: { maxSteps }` (the signer must know what fits)");
  const first = BigInt(o.firstEpoch);
  const key: WotsKey = { root: o.tree.root, pubSeed: o.tree.pubSeed, firstEpoch: first, chainId: o.binding.chainId, ruleId: o.binding.ruleId };
  const saltFor = (digest: Hex, i: number): Hex => keccak256(concat([o.tree.skSeed, digest, toHex(i, { size: 4 })]));
  const msgOf = (digest: Hex, salt: Hex): Hex => keccak256(concat([digest, salt]));
  const signDigest = (digest: Hex, ruleEpoch: bigint | number): Hex => {
    const e = BigInt(ruleEpoch);
    if (e < first) throw new IntentError(`ruleEpoch ${e} is below firstEpoch ${first}`);
    const leaf = Number(e - first);
    if (leaf >= WOTS_LEAVES) throw new IntentError(`WOTS tree exhausted: leaf ${leaf} >= ${WOTS_LEAVES}`);
    // persisted before the signature exists, but only after the grind fit the budget; a second call for the same digest reuses the first call's salt
    const salt = claimLeaf(o.store, o.tree.root, o.binding, leaf, digest, "WOTS+", () => {
      const g = grindSalt((i) => saltFor(digest, i), (s) => msgOf(digest, s), { maxTries: o.budget.maxTries ?? 200_000, targetSteps: o.budget.maxSteps });
      if (g.steps > o.budget.maxSteps) throw new StepBudgetExceeded(g.steps, o.budget.maxSteps, g.tries);
      return g.salt;
    }) as Hex;
    const entry = wotsSign(o.tree, msgOf(digest, salt), leaf); // leaf (32) ++ chains ++ path
    return concat([salt, `0x${entry.slice(2 + 64)}`]);
  };
  return {
    key,
    params: wotsParams(key),
    signDigest,
    sign: (b) => {
      assertBinding(o.binding, b);
      return signDigest(intentDigest(b), b.ruleEpoch);
    },
    stepsFor: (digest, salt) => wotsSteps(msgOf(digest, salt)),
  };
}
export { wotsKeygen, wotsVerify };

/** Reference verifier for a WotsSigner witness (mirrors the contract). */
export function wotsIntentVerify(key: WotsKey, digest: Hex, ruleEpoch: bigint | number, witness: Hex): boolean {
  if (size(witness) !== WOTS_WITNESS_BYTES || BigInt(ruleEpoch) < BigInt(key.firstEpoch)) return false;
  const leaf = BigInt(ruleEpoch) - BigInt(key.firstEpoch);
  const salt = `0x${witness.slice(2, 66)}` as Hex;
  const entry = concat([word(leaf), `0x${witness.slice(2 + 64)}`]);
  return wotsVerify(key.root, key.pubSeed, keccak256(concat([digest, salt])), entry);
}

// ---------------------------------------------------------------- params blob (SignedIntentCounter reads params from a contract's code)

/** Creation code of a contract whose runtime code is exactly `params` (12-byte loader). */
export function paramsBlobInitCode(params: Hex): Hex {
  const n = size(params);
  if (n === 0 || n > 0xffff) throw new IntentError("params must be 1..65535 bytes");
  return concat(["0x61", toHex(n, { size: 2 }), "0x80600c6000396000f3", params]);
}

// ---------------------------------------------------------------- deploying predicates and params blobs

/** Minimal clients these helpers need (any viem wallet client with an account, and a public client on the same chain). */
export interface DeployClients {
  wallet: { account?: { address: Address } | undefined; chain?: unknown; sendTransaction: (a: never) => Promise<Hex> };
  pub: { waitForTransactionReceipt: (a: { hash: Hex; timeout?: number }) => Promise<{ status: string; contractAddress?: Address | null | undefined; gasUsed: bigint }> };
}

/** Deploys creation `bytecode` with a normal transaction and returns the contract address (explicit gas: ethrex's estimate wants a large balance). */
export async function deployCode(c: DeployClients, bytecode: Hex, gas = 12_000_000n): Promise<{ address: Address; txHash: Hex; gasUsed: bigint }> {
  const send = c.wallet.sendTransaction as unknown as (a: { data: Hex; gas: bigint; account: unknown; chain: unknown }) => Promise<Hex>;
  const txHash = await send({ data: bytecode, gas, account: c.wallet.account, chain: c.wallet.chain });
  const r = await c.pub.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 });
  if (r.status !== "success" || !r.contractAddress) throw new IntentError(`deploy failed: ${txHash}`);
  return { address: getAddress(r.contractAddress), txHash, gasUsed: r.gasUsed };
}
/** Deploys a contract whose code is `params` (what SignedIntentCounter reads with EXTCODECOPY). */
export const deployParamsBlob = (c: DeployClients, params: Hex) => deployCode(c, paramsBlobInitCode(params), 4_000_000n);

/**
 * Deploy-time check of a params blob: calls the predicate's `validParams(bytes)` (MultisigSigner: well formed, bounds, PAIRWISE DISTINCT keys;
 * AttestedFactSigner: same for attestors; WebAuthnSigner: non-zero rpIdHash) and throws if it says no. Distinctness is not enforced on chain in
 * every check (it would cost O(n^2) key hashes per trigger, about 25k gas at n = 16, to guard a deployer-side mistake), so deploy helpers must call this.
 */
export async function assertValidParams(pub: { readContract: (a: never) => Promise<unknown> }, predicate: Address, params: Hex): Promise<void> {
  const read = pub.readContract as unknown as (a: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) => Promise<unknown>;
  const ok = await read({ address: predicate, abi: [{ type: "function", name: "validParams", stateMutability: "pure", inputs: [{ name: "params", type: "bytes" }], outputs: [{ type: "bool" }] }], functionName: "validParams", args: [params] });
  if (ok !== true) throw new IntentError(`predicate ${predicate} refused the params (validParams false: duplicate or malformed keys, a bound out of range, or a zero rpIdHash)`);
}
