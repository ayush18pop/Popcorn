// Sovereign Account: deploy, initialise, and build each of its triggers (contracts/src/builds/SovereignAccount.sol).
// Guardian votes carry a membership proof from @popcorn/zk (membershipProof with guardianSignal / guardianScope).
import { encodeAbiParameters, encodeDeployData, encodeFunctionData, getAddress, keccak256, type Address, type Hex } from "viem";
import { deployCode, type DeployClients } from "./intent.ts";
import { maxCostPerTrigger, type RuleContractArgs } from "./ruleContract.ts";
import { STAKING_REGISTRY } from "./deployments.ts";
import { DEFAULT_SELF_PAYING_FEES, type RuleDeployer, type SelfPayingFees } from "./privacy.ts";
import {
  ecdsaSignerBytecode,
  falconSignerBytecode,
  hybridEcdsaSignerBytecode,
  membershipVerifierBytecode,
  sovereignAccountAbi,
  sovereignAccountBytecode,
  wotsSignerBytecode,
} from "./artifacts/privacy.generated.ts";

export { sovereignAccountAbi } from "./artifacts/privacy.generated.ts";

export const ACCOUNT_KIND = { SPEND: 1n, VOTE: 2n, EXIT: 3n, MIGRATE: 4n, QUANTUM: 5n } as const;
/** IntentDigest rule ids the account uses for each signature. */
export const ACCOUNT_RULE = { SPEND: 1n, MIGRATE: 4n, QUANTUM: 5n, CONTEST: 6n } as const;
export const PROPOSAL_QUANTUM: Hex = keccak256(encodeAbiParameters([{ type: "string" }], ["quantum"]));

/** Caps: Falcon-512 verification is about 1.5M gas, so the condition gets 2M; data caps fit Falcon and WOTS+ witnesses. */
export const ACCOUNT_CAPS = { conditionGas: 2_000_000, maxVerifyDataLength: 3_400, maxTriggerDataLength: 512, maxStateGasPerFrame: 6n * 97_920n } as const;

export interface SovereignDeployment {
  account: Address;
  logic: Address;
  ownerScheme: Address;
  backupScheme: Address;
  falconSigner: Address | null;
  membershipVerifier: Address;
  args: RuleContractArgs;
  maxCost: bigint;
}

/**
 * Deploys the signer contracts (unless given), the account logic and the account (staked).
 * owner: "ecdsa+falcon" (HybridEcdsaSigner over FalconSigner, the flagship) or "ecdsa" (EcdsaSigner, for tests).
 */
export async function deploySovereignAccount(
  clients: DeployClients,
  deployer: RuleDeployer,
  o: { owner: "ecdsa+falcon" | "ecdsa"; recoveryDelaySec: bigint; fees?: SelfPayingFees; stakeAmount?: bigint; fund?: bigint; reuse?: Partial<Pick<SovereignDeployment, "ownerScheme" | "backupScheme" | "falconSigner" | "membershipVerifier">> },
): Promise<SovereignDeployment> {
  const r = o.reuse ?? {};
  const falconSigner = o.owner === "ecdsa+falcon" ? (r.falconSigner ?? (await deployCode(clients, falconSignerBytecode, 30_000_000n)).address) : null;
  const ownerScheme = r.ownerScheme ?? (await deployCode(clients, o.owner === "ecdsa+falcon" ? hybridEcdsaSignerBytecode : ecdsaSignerBytecode, 12_000_000n)).address;
  const backupScheme = r.backupScheme ?? (await deployCode(clients, wotsSignerBytecode, 24_000_000n)).address;
  const membershipVerifier = r.membershipVerifier ?? (await deployCode(clients, membershipVerifierBytecode, 8_000_000n)).address;
  const fees = o.fees ?? DEFAULT_SELF_PAYING_FEES;
  const stakeAmount = o.stakeAmount ?? 100_000_000_000_000_000n;
  const logic = await deployCode(
    clients,
    encodeDeployData({
      abi: sovereignAccountAbi,
      bytecode: sovereignAccountBytecode,
      args: [ownerScheme, backupScheme, membershipVerifier, o.recoveryDelaySec, getAddress(clients.wallet.account!.address), STAKING_REGISTRY, stakeAmount, 86_400],
    }),
    30_000_000n,
  );
  const caps = { ...ACCOUNT_CAPS, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, maxGasPerFrame: 2_200_000n };
  const maxCost = maxCostPerTrigger({ ...caps, mode: 0 });
  const d = await deployer.deployRule({ logic: logic.address, caps, fund: o.fund ?? stakeAmount + 4n * maxCost, stake: true } as never);
  return { account: d.ruleContract, logic: logic.address, ownerScheme, backupScheme, falconSigner, membershipVerifier, args: d.args, maxCost };
}

const send = async (c: DeployClients, to: Address, data: Hex, value = 0n): Promise<Hex> => {
  const s = c.wallet.sendTransaction as unknown as (a: Record<string, unknown>) => Promise<Hex>;
  const hash = await s({ to, data, value, gas: 1_500_000n, account: c.wallet.account, chain: c.wallet.chain });
  const rc = await c.pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  return hash;
};

/** One-time setup (by the deployer). ownerParams: hybridEcdsaParams(ecdsa, falconSigner, falcon.params) or ecdsaParams(ecdsa). */
export const initializeAccount = (c: DeployClients, account: Address, i: { ownerParams: Hex; exitAddress: Address; backupParams: Hex; guardiansRoot: bigint; threshold: bigint }) =>
  send(c, account, encodeFunctionData({ abi: sovereignAccountAbi, functionName: "initialize", args: [keccak256(i.ownerParams), getAddress(i.exitAddress), keccak256(i.backupParams), i.guardiansRoot, i.threshold] }));

export const finalizeRecovery = (c: DeployClients, account: Address) => send(c, account, encodeFunctionData({ abi: sovereignAccountAbi, functionName: "finalizeRecovery" }));

export const contestRecovery = (c: DeployClients, account: Address, ownerParams: Hex, witness: Hex) =>
  send(c, account, encodeFunctionData({ abi: sovereignAccountAbi, functionName: "contest", args: [ownerParams, witness] }));

/** The intent binding each owner/backup signature covers. */
export const accountBinding = (chainId: bigint, account: Address, ruleId: bigint, ruleEpoch: bigint, triggerData: Hex) => ({ chainId, ruleContract: getAddress(account), ruleId, ruleEpoch, triggerData });
/** The contest signature signs this "trigger data" (its keccak is the popArgsHash): keccak256("contest") is what the contract uses. */
export const CONTEST_PREIMAGE: Hex = "0x636f6e74657374"; // "contest"

// ---------------------------------------------------------------- triggers (triggerData + verifyData)

const ownerVD = (params: Hex, witness: Hex) => encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [params, witness]);

export const spendData = (to: Address, value: bigint, data: Hex = "0x"): Hex =>
  encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes" }], [ACCOUNT_KIND.SPEND, getAddress(to), value, data]);
export const spendTrigger = (triggerData: Hex, ownerParams: Hex, witness: Hex) => ({ triggerData, verifyData: ownerVD(ownerParams, witness) });

export const quantumData: Hex = encodeAbiParameters([{ type: "uint256" }], [ACCOUNT_KIND.QUANTUM]);
export const quantumTrigger = (ownerParams: Hex, witness: Hex) => ({ triggerData: quantumData, verifyData: ownerVD(ownerParams, witness) });

export const exitTrigger = () => ({ triggerData: encodeAbiParameters([{ type: "uint256" }], [ACCOUNT_KIND.EXIT]), verifyData: "0x" as Hex });

export const migrateData = (target: Address): Hex => encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [ACCOUNT_KIND.MIGRATE, getAddress(target)]);
export const migrateTrigger = (target: Address, backupParams: Hex, wotsWitness: Hex) => ({ triggerData: migrateData(target), verifyData: ownerVD(backupParams, wotsWitness) });

export const voteTrigger = (proposal: Hex, nullifierHash: bigint, proof: Hex) => ({
  triggerData: encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }, { type: "uint256" }], [ACCOUNT_KIND.VOTE, proposal, nullifierHash]),
  verifyData: proof,
});

/** A rotation proposal is the new owner params hash. */
export const rotationProposal = (newOwnerParams: Hex): Hex => keccak256(newOwnerParams);
/** Membership-proof inputs for a guardian vote (the Anonymous Group Vote block). */
export const guardianSignal = (proposal: Hex, round: bigint): bigint => BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [proposal, round]))) >> 8n;
export const guardianScope = (account: Address, round: bigint): bigint => BigInt(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [getAddress(account), round]))) >> 8n;
