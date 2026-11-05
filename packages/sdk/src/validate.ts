// Static (state-independent) validity rules for a frame tx, mirroring ethrex
// `FrameTransaction::validate_static_constraints` (crates/common/types/transaction.rs:2658-3011,
// commit 9aa3645). EIP-8312 (UTXO frames, vault sender) is not modelled: mode 5 is reported as
// unsupported, as on this devnet where UTXO frames are inactive.
import { hexToBytes, type Address } from "viem";
import { FrameTxInvalid } from "./errors.ts";
import { FrameFlags, FrameMode, SignatureScheme, type FrameTx } from "./types.ts";

export const FRAME_TX_MAX_FRAMES = 64;
export const FRAME_TX_MAX_NONCE_KEYS = 16;
export const FRAME_TX_MAX_RECENT_ROOT_REFERENCES = 16;
/** EIP-7594 per-tx blob limit (ethrex MAX_BLOBS_PER_TX). */
export const MAX_BLOBS_PER_TX = 6;
export const VERSIONED_HASH_VERSION_KZG = 0x01;
/** EIP-8141 expiry verifier predeploy; a VERIFY frame targeting it has a fixed shape. */
export const EXPIRY_VERIFIER: Address = "0x0000000000000000000000000000000000008141";
export const EXPIRY_DATA_LENGTH = 8;

const U64_MAX = (1n << 64n) - 1n;
const I64_MAX = (1n << 63n) - 1n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SCOPE_MASK = 0x03;

const lower = (a: string | null) => (a === null ? null : a.toLowerCase());
const byteLen = (h: string) => (h.length - 2) / 2;

/**
 * Returns every static-rule violation (empty array = statically valid). Messages follow
 * ethrex's wording. Does not check state (nonces, balances) or mempool policy (prefix
 * shapes, the 100k verify budget).
 */
export function validateFrameTx(tx: FrameTx): string[] {
  const issues: string[] = [];
  const sender = tx.sender.toLowerCase();
  if (sender === ZERO_ADDRESS) issues.push("tx.sender must not be zero address");

  // EIP-8250 keyed nonces
  if (tx.nonceKeys.length < 1 || tx.nonceKeys.length > FRAME_TX_MAX_NONCE_KEYS) {
    issues.push(`nonce_keys count must be between 1 and ${FRAME_TX_MAX_NONCE_KEYS}`);
  }
  for (let i = 1; i < tx.nonceKeys.length; i++) {
    if (tx.nonceKeys[i - 1]! >= tx.nonceKeys[i]!) {
      issues.push("nonce_keys must be strictly increasing");
      break;
    }
  }
  if (tx.nonceKeys.length > 1 && tx.nonceKeys[0] === 0n) issues.push("nonce key 0 is only valid as the sole nonce key");
  if (tx.nonceSeq === U64_MAX) issues.push("nonce_seq must be < 2**64 - 1");

  // EIP-8272
  if (tx.recentRootReferences.length > FRAME_TX_MAX_RECENT_ROOT_REFERENCES) {
    issues.push(`recent_root_references count must be <= ${FRAME_TX_MAX_RECENT_ROOT_REFERENCES}`);
  }
  if (tx.frames.length < 1 || tx.frames.length > FRAME_TX_MAX_FRAMES) issues.push(`Frame count must be between 1 and ${FRAME_TX_MAX_FRAMES}`);

  // blobs
  tx.blobHashes.forEach((h, i) => {
    if (hexToBytes(h)[0] !== VERSIONED_HASH_VERSION_KZG) issues.push(`Blob versioned hash ${i}: wrong version byte`);
  });
  if (tx.blobHashes.length > MAX_BLOBS_PER_TX) issues.push(`Blob count must not exceed ${MAX_BLOBS_PER_TX}, got ${tx.blobHashes.length}`);
  if (tx.blobHashes.length === 0 && tx.fees.maxFeePerBlobGas !== 0n) issues.push("max_fee_per_blob_gas must be zero when the transaction carries no blobs");

  // signatures
  tx.signatures.forEach((s, i) => {
    const scheme = s.scheme as number;
    if (scheme === SignatureScheme.ARBITRARY) {
      if (s.signer !== null) issues.push(`Signature ${i}: ARBITRARY signatures must not name a signer`);
    } else if (scheme !== SignatureScheme.SECP256K1 && scheme !== SignatureScheme.P256) {
      issues.push(`Signature ${i}: unsupported scheme ${scheme}`);
    }
    const n = byteLen(s.msg);
    if (n === 32) {
      if (/^0x0{64}$/.test(s.msg)) issues.push(`Signature ${i}: explicit msg must not be zero digest`);
    } else if (n !== 0) issues.push(`Signature ${i}: msg must be empty or 32 bytes, got ${n}`);
  });

  // frames
  let totalGas = 0n;
  let expiryFrames = 0;
  tx.frames.forEach((f, i) => {
    const mode = f.mode as number;
    const known = mode === FrameMode.DEFAULT || mode === FrameMode.VERIFY || mode === FrameMode.SENDER;
    if (!known) {
      issues.push(mode === 5 ? `Frame ${i}: UTXO frames are not active at this block (EIP-8312)` : `Frame ${i}: reserved execution mode ${mode}`);
    }
    if (f.flags >= 8) issues.push(`Frame ${i}: reserved flag bits must be zero (flags=0x${f.flags.toString(16).padStart(2, "0")})`);

    if (mode === FrameMode.VERIFY && lower(f.target) === EXPIRY_VERIFIER) {
      if (++expiryFrames > 1) issues.push(`Frame ${i}: more than one expiry verifier frame`);
      if (f.flags !== 0) issues.push(`Frame ${i}: expiry verifier frame must have flags == 0`);
      if (byteLen(f.data) !== EXPIRY_DATA_LENGTH) issues.push(`Frame ${i}: expiry verifier frame data must be ${EXPIRY_DATA_LENGTH} bytes`);
      if (f.value !== 0n) issues.push(`Frame ${i}: expiry verifier frame must have value == 0`);
      if (f.stateGasLimit !== 0n) issues.push(`Frame ${i}: expiry verifier frame must have limits.state == 0`);
    }
    if (mode !== FrameMode.SENDER && f.value !== 0n) issues.push(`Frame ${i}: non-zero value only allowed in SENDER mode (mode=${mode}, value=${f.value})`);
    if (f.gasLimit > I64_MAX) issues.push(`Frame ${i}: gas_limit ${f.gasLimit} exceeds 2**63-1`);
    totalGas += f.gasLimit + f.stateGasLimit;
    if (totalGas > I64_MAX) issues.push(`Frame ${i}: cumulative frame gas_limit ${totalGas} exceeds 2**63-1`);

    if (f.flags & FrameFlags.APPROVE_EXECUTION && f.target !== null && lower(f.target) !== sender) {
      issues.push(`Frame ${i}: APPROVE_EXECUTION requires an empty target or tx.sender`);
    }
    const atomic = (f.flags & FrameFlags.ATOMIC_BATCH) !== 0;
    if (atomic) {
      const next = tx.frames[i + 1];
      if (mode === FrameMode.VERIFY) issues.push(`Frame ${i}: atomic batch flag on a VERIFY frame`);
      else if (!next) issues.push(`Frame ${i}: atomic batch flag on last frame`);
      else if (next.mode === FrameMode.VERIFY) issues.push(`Frame ${i}: atomic batch flag followed by a VERIFY frame`);
    }
    const prev = tx.frames[i - 1];
    const inBatch = atomic || (prev !== undefined && (prev.flags & FrameFlags.ATOMIC_BATCH) !== 0);
    if (inBatch && (f.flags & SCOPE_MASK) !== 0) issues.push(`Frame ${i}: a frame in an atomic batch must not approve a scope`);
  });
  return issues;
}

/** Throws FrameTxInvalid listing every violation. */
export function assertValidFrameTx(tx: FrameTx): void {
  const issues = validateFrameTx(tx);
  if (issues.length) throw new FrameTxInvalid(issues);
}
