// Open Sponsor: a payer contract with a public, on-chain policy (contracts/sponsor/OpenSponsor.yul).
// A caller-pays rule contract names it as `payer` and adds its accounting tail; nobody signs anything for the sponsor.
import { concat, encodeAbiParameters, encodeFunctionData, getAddress, pad, toHex, type Address, type Hex } from "viem";
import { openSponsorCreationCode } from "./artifacts/sponsor.generated.ts";
import { deployCode, type DeployClients } from "./intent.ts";
import { STAKING_REGISTRY } from "./deployments.ts";
import type { TriggerTail } from "./ruleContract.ts";

export { openSponsorCreationCode, OPEN_SPONSOR_CREATION_CODE_HASH } from "./artifacts/sponsor.generated.ts";

export const openSponsorAbi = [
  { type: "function", name: "setLimit", stateMutability: "nonpayable", inputs: [{ name: "sender", type: "address" }, { name: "limit", type: "uint256" }], outputs: [] },
  { type: "function", name: "setDefaultLimit", stateMutability: "nonpayable", inputs: [{ name: "limit", type: "uint256" }], outputs: [] },
  { type: "function", name: "setMaxFee", stateMutability: "nonpayable", inputs: [{ name: "maxFee", type: "uint256" }], outputs: [] },
  { type: "function", name: "setPeriod", stateMutability: "nonpayable", inputs: [{ name: "period", type: "uint256" }], outputs: [] },
  { type: "function", name: "setOpen", stateMutability: "nonpayable", inputs: [{ name: "open", type: "bool" }], outputs: [] },
  { type: "function", name: "allowLogic", stateMutability: "nonpayable", inputs: [{ name: "logic", type: "address" }, { name: "allowed", type: "bool" }], outputs: [] },
  { type: "function", name: "setGate", stateMutability: "nonpayable", inputs: [{ name: "verifier", type: "address" }, { name: "root", type: "uint256" }], outputs: [] },
  { type: "function", name: "transferOwnership", stateMutability: "nonpayable", inputs: [{ name: "owner", type: "address" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "stake", stateMutability: "payable", inputs: [{ name: "registry", type: "address" }, { name: "unstakeDelaySec", type: "uint32" }], outputs: [] },
  { type: "function", name: "unlockStake", stateMutability: "nonpayable", inputs: [{ name: "registry", type: "address" }], outputs: [] },
  { type: "function", name: "withdrawStake", stateMutability: "nonpayable", inputs: [{ name: "registry", type: "address" }, { name: "to", type: "address" }], outputs: [] },
  { type: "function", name: "roll", stateMutability: "nonpayable", inputs: [{ name: "sender", type: "address" }], outputs: [] },
  { type: "function", name: "record", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "limitOf", stateMutability: "view", inputs: [{ name: "sender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "spentOf", stateMutability: "view", inputs: [{ name: "sender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "periodStartOf", stateMutability: "view", inputs: [{ name: "sender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "admitted", stateMutability: "view", inputs: [{ name: "sender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "logicAllowed", stateMutability: "view", inputs: [{ name: "logic", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nullifierUsed", stateMutability: "view", inputs: [{ name: "nullifier", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "externalNullifier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "period", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "defaultLimit", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "open", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "gateVerifier", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "gateRoot", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/** The sponsor's 32-byte revert codes (contracts/sponsor/OpenSponsor.yul). */
export const OPEN_SPONSOR_ERRORS: Record<number, string> = {
  0x60: "not the payer frame (frame 1, VERIFY)",
  0x61: "payer frame flags are not 1 (payment only)",
  0x62: "not exactly four frames: the accounting tail is missing",
  0x63: "the tail is not a DEFAULT frame",
  0x64: "the tail does not target the sponsor",
  0x65: "the tail's flags are not 0",
  0x66: "the tail carries value",
  0x67: "the tail's data is not record()",
  0x68: "the tail's execution limit is below 60,000",
  0x69: "the tail's state limit is below 489,600",
  0x6a: "this sender is not sponsored",
  0x6b: "max fee per gas is above the sponsor's cap",
  0x6c: "the sender's budget for this period is spent",
  0x6d: "this membership nullifier was already used",
  0x6e: "the membership proof was rejected",
  0x6f: "unexpected payer frame data (only a membership proof may be there)",
  0x70: "record() outside the accounting tail",
  0x71: "record(): this sponsor did not pay for the transaction",
  0x72: "not the owner",
  0x73: "unknown function",
  0x74: "withdraw failed",
  0x75: "a staking registry call failed",
};

export interface OpenSponsorConfig {
  owner: Address;
  /** Budget period in seconds; a sender's spending resets once this much time has passed (in the tail or roll()). */
  period: bigint;
  /** Highest max_fee_per_gas the sponsor accepts. */
  maxFee: bigint;
  /** Budget per sender per period, in wei of worst-case cost, for senders without their own limit. */
  defaultLimit: bigint;
}

/** Creation code with the four constructor words appended. */
export const openSponsorInitCode = (c: OpenSponsorConfig): Hex =>
  concat([openSponsorCreationCode, encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [getAddress(c.owner), c.period, c.maxFee, c.defaultLimit])]);

export async function deployOpenSponsor(clients: DeployClients, c: OpenSponsorConfig): Promise<{ address: Address; txHash: Hex; gasUsed: bigint }> {
  return deployCode(clients, openSponsorInitCode(c), 12_000_000n);
}

/** Execution and state gas the sponsor requires on its accounting tail. */
export const SPONSOR_TAIL_GAS = 60_000n;
export const SPONSOR_TAIL_STATE_GAS = 489_600n;
/** Payer frame limits: the policy plus the 20,000 first use of the rule contract's key; with a membership proof, plus a Groth16 check. */
export const SPONSOR_PAYER_GAS = 60_000n;
export const SPONSOR_PAYER_GAS_WITH_PROOF = 340_000n;

/** The accounting frame every sponsored trigger must end with (frame 3). */
export const sponsorTail = (sponsor: Address): TriggerTail => ({ target: getAddress(sponsor), data: "0x266cf109", gasLimit: SPONSOR_TAIL_GAS, stateGasLimit: SPONSOR_TAIL_STATE_GAS });

/** Frame 1 data for a membership admission: the Groth16 proof (256 bytes) followed by the nullifier hash. */
export function membershipPayerData(proof: Hex, nullifierHash: bigint): Hex {
  if ((proof.length - 2) / 2 !== 256) throw new Error("membership proof must be 256 bytes");
  return concat([proof, pad(toHex(nullifierHash), { size: 32 })]);
}

/** Trigger options for a sponsored trigger: `client.trigger(ruleContract, { ...sponsored(sponsor), triggerData })`. */
export function sponsored(sponsor: Address, membership?: { proof: Hex; nullifierHash: bigint }) {
  return {
    payer: getAddress(sponsor),
    tail: sponsorTail(sponsor),
    payerGasLimit: membership ? SPONSOR_PAYER_GAS_WITH_PROOF : SPONSOR_PAYER_GAS,
    ...(membership ? { payerData: membershipPayerData(membership.proof, membership.nullifierHash) } : {}),
  };
}

/**
 * Stakes the sponsor in the ERC-8421 registry (from the sponsor itself; the owner sends the stake). The policy reads the
 * sponsor's own global settings, which the alternative mempool allows only for a staked payer.
 */
export async function stakeOpenSponsor(
  clients: DeployClients,
  sponsor: Address,
  o: { amount: bigint; unstakeDelaySec?: number; registry?: Address },
): Promise<Hex> {
  const send = clients.wallet.sendTransaction as unknown as (a: Record<string, unknown>) => Promise<Hex>;
  const data = encodeFunctionData({ abi: openSponsorAbi, functionName: "stake", args: [o.registry ?? STAKING_REGISTRY, o.unstakeDelaySec ?? 86_400] });
  const hash = await send({ to: sponsor, data, value: o.amount, gas: 300_000n, account: clients.wallet.account, chain: clients.wallet.chain });
  const r = await clients.pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`stake failed: ${hash}`);
  return hash;
}
