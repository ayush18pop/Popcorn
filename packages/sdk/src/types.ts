// EIP-8141 frame transaction types, mirroring contracts/core/SPEC.md §5-§7 and §10 exactly.
// Wire layout (SPEC §6):
//   0x06 || rlp([chain_id, nonce_keys, nonce_seq, sender, frames, signatures,
//                [max_priority_fee_per_gas, max_fee_per_gas, max_fee_per_blob_gas],
//                blob_versioned_hashes, recent_root_references])
// Integer widths follow ethrex `FrameTransaction` (crates/common/types/transaction.rs):
// u64 for chain_id, nonce_seq, frame limits, the two per-gas fees and slot; U256 for
// nonce keys, frame value and max_fee_per_blob_gas; u8 for mode, flags and scheme.
import type { Address, Hex } from "viem";

/** Tx type byte (SPEC §6). */
export const FRAME_TX_TYPE = 0x06;

/** Caller of DEFAULT and VERIFY frames (SPEC §5). */
export const ENTRY_POINT: Address = "0x00000000000000000000000000000000000000aa";

/** EIP-8250 nonce manager predeploy (SPEC §7). */
export const NONCE_MANAGER: Address = "0x0000000000000000000000000000000000008250";

/** EIP-8272 recent-root predeploy (SPEC §10). */
export const RECENT_ROOT_ADDRESS: Address = "0x0000000000000000000000000000000000008272";

/** Frame modes (SPEC §5). 3-4 are reserved and 5 (UTXO, EIP-8312) is out of scope. */
export const FrameMode = {
  DEFAULT: 0,
  VERIFY: 1,
  SENDER: 2,
} as const;
export type FrameMode = (typeof FrameMode)[keyof typeof FrameMode];

/**
 * Frame flags (SPEC §5): bits 0-1 = allowed APPROVE scope, bit 2 = atomic batch
 * (DEFAULT and SENDER only), bits 3-7 must be zero.
 */
export const FrameFlags = {
  NONE: 0x00,
  /** scope 1: may APPROVE payment (payer VERIFY frame in caller-pays). */
  APPROVE_PAYMENT: 0x01,
  /** scope 2: may APPROVE execution (rule contract VERIFY frame in caller-pays). */
  APPROVE_EXECUTION: 0x02,
  /** scope 3: may APPROVE both (rule contract VERIFY frame in rule-pays). */
  APPROVE_EXECUTION_AND_PAYMENT: 0x03,
  ATOMIC_BATCH: 0x04,
} as const;

/** Largest flags value allowed on the wire (bits 0-2). */
export const MAX_FRAME_FLAGS = 0x07;

/** Signature schemes (SPEC §6). */
export const SignatureScheme = {
  /** Opaque bytes, `signer` must be empty; readable in VERIFY with SIGPARAM/SIGDATACOPY. */
  ARBITRARY: 0,
  /** 65 bytes `v || r || s`, v in {0,1}, low s. */
  SECP256K1: 1,
  /** 128 bytes `r || s || qx || qy`. */
  P256: 2,
} as const;
export type SignatureScheme = (typeof SignatureScheme)[keyof typeof SignatureScheme];

/** One frame: RLP `[mode, flags, target, [limit_execution, limit_state], value, data]`. */
export interface Frame {
  mode: FrameMode;
  /** u8; see {@link FrameFlags}. */
  flags: number;
  /** `null` encodes as empty bytes and resolves to `tx.sender`. */
  target: Address | null;
  /** `limits.execution`, u64. */
  gasLimit: bigint;
  /** `limits.state` (EIP-8037 state gas), u64. */
  stateGasLimit: bigint;
  /** U256 wei. */
  value: bigint;
  data: Hex;
}

/** One signature entry: RLP `[scheme, signer, msg, signature]`. */
export interface SignatureEntry {
  scheme: SignatureScheme;
  /** `null` encodes as empty bytes (= tx.sender); must be `null` for ARBITRARY. */
  signer: Address | null;
  /**
   * `"0x"` or a 32-byte digest. When empty, the `signature` bytes are excluded from
   * the signature hash (the entry signs the sig hash itself).
   */
  msg: Hex;
  signature: Hex;
}

/** Nested fee list `[max_priority_fee_per_gas, max_fee_per_gas, max_fee_per_blob_gas]`. */
export interface FrameTxFees {
  /** u64 */
  maxPriorityFeePerGas: bigint;
  /** u64 */
  maxFeePerGas: bigint;
  /** U256 */
  maxFeePerBlobGas: bigint;
}

/** EIP-8272 reference `[source_id(32), slot(u64), root(32)]`. */
export interface RecentRootReference {
  sourceId: Hex;
  slot: bigint;
  root: Hex;
}

export interface FrameTx {
  /** u64 */
  chainId: bigint;
  /** 1..16 U256 keys, strictly increasing; `[0n]` = legacy account nonce. */
  nonceKeys: bigint[];
  /** u64, < 2^64-1 */
  nonceSeq: bigint;
  sender: Address;
  frames: Frame[];
  signatures: SignatureEntry[];
  fees: FrameTxFees;
  /** `blob_versioned_hashes`, 32 bytes each. */
  blobHashes: Hex[];
  /** 0..16 entries. */
  recentRootReferences: RecentRootReference[];
}
