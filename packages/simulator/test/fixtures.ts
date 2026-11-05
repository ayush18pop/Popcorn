// Fixtures built from recorded devnet outputs.
import type { SimulateResultLike } from "../src/types.ts";

const word = (code: number) => `0x${code.toString(16).padStart(64, "0")}`;
export { word };

const base = (): SimulateResultLike => ({
  verifyGasLimit: 60_000n,
  ethrex: {
    valid: true, executionStatus: "success", canonicalMempoolValid: true, canonicalMempoolViolation: null,
    error: null, revertData: null, verifyGas: 27_990n, gasUsed: 90_000n, maxCost: 528_348_000_000_000n,
  },
  sidecar: { admitted: true, code: null, message: "admitted" },
  ruleContractBalance: 10_000_000_000_000_000n,
  minOperatingBalance: 600_000_000_000_000n,
  maxCost: 528_348_000_000_000n,
});

/** A good trigger. ethrex valid + canonical, VERIFY gas 27,990, sidecar admitted. */
export const validRuleContract = (): SimulateResultLike => base();

/** An unstaked shield. ethrex valid but non-canonical; sidecar -32502. */
export const unstakedShield = (): SimulateResultLike => ({
  ...base(),
  verifyGasLimit: 50_000n,
  ethrex: { ...base().ethrex, canonicalMempoolValid: false, canonicalMempoolViolation: "StorageReadNonSender", verifyGas: 31_494n },
  sidecar: {
    admitted: false, code: -32502,
    message: "unstaked sender accessed 0xbb437398da33287286bc9aa2fc229ee825f74cae slot 0x0eaf3564059a013bd9c44fe431c80cca91e90f06988a25fcead8fd037677c900",
  },
});

/** A 149,195-gas prefix under devnet1 rules. Public 100k rejects, patched sidecar admits. */
export const exploitOver100k = (): SimulateResultLike => ({
  ...base(),
  verifyGasLimit: 149_195n,
  ethrex: {
    ...base().ethrex, canonicalMempoolValid: false,
    canonicalMempoolViolation: "prefix gas budget exceeded: 149195 > 100000", verifyGas: 148_000n,
  },
  sidecar: { admitted: true, code: null, message: "admitted" },
});

/** Same exploit rule contract, 260,000 unstaked (L3b): ethrex and the sidecar both refuse. */
export const exploitOver250k = (): SimulateResultLike => ({
  ...base(),
  verifyGasLimit: 260_000n,
  ethrex: { ...base().ethrex, valid: false, executionStatus: null, error: "Frame transaction prefix gas budget (frames + sig cost) exceeds MAX_VERIFY_GAS", verifyGas: null },
  sidecar: { admitted: false, code: -32602, message: "entity 0x995B0000000000000000000000000000000B0882 validation gas 260000 exceeds unstaked budget 250000 (BUDGET-010)" },
});

/** Condition writes storage in VERIFY. MEASURED: Core 0x20 from ethrex and the sidecar, no other text. */
export const writesStorage = (): SimulateResultLike => ({
  ...base(),
  ethrex: {
    ...base().ethrex, valid: false, executionStatus: null, verifyGas: null, revertData: word(0x20),
    canonicalMempoolValid: false, canonicalMempoolViolation: "validation prefix frame reverted",
    error: "Invalid Transaction: Invalid frame transaction: VERIFY frame 0 (target 0x6f74a07f7086fb1f0b938d00da0ae316f06fd8ad, 3428 bytes of code) failed: RevertOpcode",
  },
  sidecar: { admitted: false, code: -32500, message: `validation frame 0: reverted with data ${word(0x20)}` },
});

/** An underfunded rule contract: balance 1e14 < max cost 528,348,000,000,000. */
export const poorRuleContract = (): SimulateResultLike => ({
  ...base(),
  ethrex: { ...base().ethrex, valid: false, executionStatus: null, verifyGas: null, error: "VERIFY frame 0 (target 0x643c42bcd6073e859158f48aa7390a34894e7200) failed: RevertOpcode" },
  sidecar: {
    admitted: false, code: -32500,
    message: "validation frame 0: the payer 0x643c42bcd6073e859158f48aa7390a34894e7200 has 100000000000000 wei, the transaction's maximum cost is 528348000000000 wei",
  },
  ruleContractBalance: 100_000_000_000_000n,
});

/** Condition false, Core 0x22 from ethrex revertData and the sidecar -32500 message. */
export const conditionFalse = (): SimulateResultLike => ({
  ...base(),
  ethrex: { ...base().ethrex, valid: false, executionStatus: null, verifyGas: null, revertData: word(0x22) },
  sidecar: { admitted: false, code: -32500, message: `validation frame 0: reverted with data ${word(0x22)}` },
});

/** Replay of a used key. */
export const replay = (): SimulateResultLike => ({
  ...base(),
  ethrex: { ...base().ethrex, valid: false, executionStatus: null, verifyGas: null, error: "Invalid Transaction: Nonce mismatch: expected 1, got 0" },
  sidecar: { admitted: false, code: -32500, message: "Invalid Transaction: Nonce mismatch: expected 1, got 0" },
});
