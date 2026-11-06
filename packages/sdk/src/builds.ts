// Trigger helpers for the example builds in contracts/src/builds that are not covered elsewhere (Sovereign Account: account.ts;
// Private Pool and Stealth Vault: privacy.ts).
import { encodeAbiParameters, getAddress, type Address, type Hex } from "viem";

/** Proof-of-Exploit Bounty, claim: Proof That The Rules Were Broken pays `recipient` (bound in the proof) and pauses the vault. */
export const bountyClaim = (recipient: Address, claimId: bigint, proof: Hex) => ({
  triggerData: encodeAbiParameters([{ type: "address" }, { type: "uint64" }], [getAddress(recipient), claimId]),
  verifyData: proof,
});

/** Proof-of-Exploit Bounty, watch: Value Crosses A Line (share price below the floor) pauses the vault and pays a small,
 *  copyable reward to `reporter`. */
export const bountyWatch = (reporter: Address) => ({
  triggerData: encodeAbiParameters([{ type: "address" }], [getAddress(reporter)]),
  verifyData: "0x" as Hex,
});
