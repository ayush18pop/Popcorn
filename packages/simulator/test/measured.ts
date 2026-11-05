// Recorded on the LOCAL devnet (chain 1338) by packages/sdk/scripts/measure-9b.ts: the raw ethrex and sidecar
// verdicts of one fixture rule contract per failure (contracts/src/test/SimFixtures.sol), plus the stake the SDK read from the
// staking registry. Nothing is hand-written. Numbers are strings in the recording.
import type { SimulateResultLike } from "../src/types.ts";

const B = (s: unknown) => (s === null || s === undefined ? null : BigInt(s as string));
interface Rec {
  verifyGasLimit: string; ethrex: Record<string, unknown>; sidecar: { admitted: boolean; code: number | null; message: string };
  ruleContractBalance: string; minOperatingBalance: string; maxCost: string; prefixGas: string;
  stake: { registry: string; stake: string; isStaked: boolean };
}
const rec = (r: Rec): SimulateResultLike => ({
  network: "local",
  verifyGasLimit: BigInt(r.verifyGasLimit),
  ethrex: { ...(r.ethrex as unknown as SimulateResultLike["ethrex"]), verifyGas: B(r.ethrex.verifyGas), gasUsed: B(r.ethrex.gasUsed), maxCost: B(r.ethrex.maxCost) },
  sidecar: r.sidecar,
  ruleContractBalance: BigInt(r.ruleContractBalance), minOperatingBalance: BigInt(r.minOperatingBalance), maxCost: BigInt(r.maxCost), prefixGas: BigInt(r.prefixGas),
  stake: { registry: r.stake.registry, stake: BigInt(r.stake.stake), isStaked: r.stake.isStaked },
});

export const measuredReadOther = (): SimulateResultLike =>
  rec({
  "verifyGasLimit": "37417",
  "ethrex": {
    "valid": true,
    "executionStatus": "success",
    "canonicalMempoolValid": false,
    "canonicalMempoolViolation": "StorageReadNonSender",
    "error": null,
    "revertData": null,
    "verifyGas": "33878",
    "gasUsed": "50060",
    "maxCost": "447251006261514"
  },
  "sidecar": {
    "admitted": false,
    "code": -32502,
    "message": "unstaked payer accessed 0xf91be48a9485ee449735c522694b8b9eab7376e5 slot 0x0000000000000000000000000000000000000000000000000000000000000000"
  },
  "ruleContractBalance": "50000000000000000",
  "minOperatingBalance": "2494296087300360",
  "maxCost": "447251006261514",
  "prefixGas": "37417",
  "stake": {
    "registry": "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f",
    "stake": "0",
    "isStaked": false
  }
});

export const measuredHeavy = (): SimulateResultLike =>
  rec({
  "verifyGasLimit": "220274",
  "ethrex": {
    "valid": true,
    "executionStatus": "success",
    "canonicalMempoolValid": true,
    "canonicalMempoolViolation": null,
    "error": null,
    "revertData": null,
    "verifyGas": "151273",
    "gasUsed": "167455",
    "maxCost": "650478009106692"
  },
  "sidecar": {
    "admitted": true,
    "code": null,
    "message": "admitted"
  },
  "ruleContractBalance": "50000000000000000",
  "minOperatingBalance": "2657256093003960",
  "maxCost": "650478009106692",
  "prefixGas": "220274",
  "stake": {
    "registry": "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f",
    "stake": "0",
    "isStaked": false
  }
});

export const measuredWritesStorage = (): SimulateResultLike =>
  rec({
  "verifyGasLimit": "200000",
  "ethrex": {
    "valid": false,
    "executionStatus": null,
    "canonicalMempoolValid": false,
    "canonicalMempoolViolation": "validation prefix frame reverted",
    "error": "Invalid Transaction: Invalid frame transaction: VERIFY frame 0 (target 0x7091de000964c5cc3f5f97070f672cadf5c5b00b, 3428 bytes of code) failed: RevertOpcode",
    "revertData": "0x0000000000000000000000000000000000000000000000000000000000000020",
    "verifyGas": null,
    "gasUsed": null,
    "maxCost": "609834008537676"
  },
  "sidecar": {
    "admitted": false,
    "code": -32500,
    "message": "validation frame 0: reverted with data 0x0000000000000000000000000000000000000000000000000000000000000020"
  },
  "ruleContractBalance": "50000000000000000",
  "minOperatingBalance": "2494296087300360",
  "maxCost": "609834008537676",
  "prefixGas": "200000",
  "stake": {
    "registry": "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f",
    "stake": "0",
    "isStaked": false
  }
});

export const measuredPoor = (): SimulateResultLike =>
  rec({
  "verifyGasLimit": "100000",
  "ethrex": {
    "valid": false,
    "executionStatus": null,
    "canonicalMempoolValid": false,
    "canonicalMempoolViolation": "validation prefix frame reverted",
    "error": "Invalid Transaction: Invalid frame transaction: VERIFY frame 0 (target 0xee8414aa4dc6ace549daf0086f2ce4241fa36aa4, 3428 bytes of code) failed: RevertOpcode",
    "revertData": null,
    "verifyGas": null,
    "gasUsed": null,
    "maxCost": "509834007137676"
  },
  "sidecar": {
    "admitted": false,
    "code": -32500,
    "message": "validation frame 0: the payer 0xee8414aa4dc6ace549daf0086f2ce4241fa36aa4 has 1000 wei, the transaction's maximum cost is 509834007137676 wei"
  },
  "ruleContractBalance": "1000",
  "minOperatingBalance": "2494296087300360",
  "maxCost": "509834007137676",
  "prefixGas": "100000",
  "stake": {
    "registry": "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f",
    "stake": "0",
    "isStaked": false
  }
});

export const measuredValid = (): SimulateResultLike =>
  rec({
  "verifyGasLimit": "37417",
  "ethrex": {
    "valid": true,
    "executionStatus": "success",
    "canonicalMempoolValid": true,
    "canonicalMempoolViolation": null,
    "error": null,
    "revertData": null,
    "verifyGas": "28136",
    "gasUsed": "44318",
    "maxCost": "447251006261514"
  },
  "sidecar": {
    "admitted": true,
    "code": null,
    "message": "admitted"
  },
  "ruleContractBalance": "50000000000000000",
  "minOperatingBalance": "2494296087300360",
  "maxCost": "447251006261514",
  "prefixGas": "37417",
  "stake": {
    "registry": "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f",
    "stake": "0",
    "isStaked": false
  }
});

export const measuredStakedRead = (): SimulateResultLike =>
  rec({
  "verifyGasLimit": "37837",
  "ethrex": {
    "valid": true,
    "executionStatus": "success",
    "canonicalMempoolValid": false,
    "canonicalMempoolViolation": "StorageReadNonSender",
    "error": null,
    "revertData": null,
    "verifyGas": "34398",
    "gasUsed": "50881",
    "maxCost": "551831007725634"
  },
  "sidecar": {
    "admitted": true,
    "code": null,
    "message": "admitted"
  },
  "ruleContractBalance": "399605493997238458",
  "minOperatingBalance": "2910936101882760",
  "maxCost": "551831007725634",
  "prefixGas": "37837",
  "stake": {
    "registry": "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f",
    "stake": "100000000000000000",
    "isStaked": true
  }
});
