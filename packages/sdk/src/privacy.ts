// Private pool and stealth vault: deploy, deposit or pay, and build the withdrawal and spend triggers.
// Proofs come from @popcorn/zk (withdrawProof, stealthProof); this module only encodes and sends.
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { bytesToHex, concat, encodeAbiParameters, encodeDeployData, encodeFunctionData, getAddress, hexToBytes, keccak256, parseAbiItem, type Address, type Hex } from "viem";
import { deployCode, type DeployClients } from "./intent.ts";
import { maxCostPerTrigger, type RuleContractArgs } from "./ruleContract.ts";
import { STAKING_REGISTRY } from "./deployments.ts";
import {
  poseidon2CreationCode,
  privatePoolAbi,
  privatePoolBytecode,
  stealthVaultAbi,
  stealthVaultBytecode,
  stealthVerifierBytecode,
  withdrawVerifierBytecode,
} from "./artifacts/privacy.generated.ts";

export { privatePoolAbi, stealthVaultAbi } from "./artifacts/privacy.generated.ts";

/** BN254 scalar field. */
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Fee caps for a module that pays its own triggers: the module's minimum fee is the worst case at these caps. */
export interface SelfPayingFees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}
export const DEFAULT_SELF_PAYING_FEES: SelfPayingFees = { maxFeePerGas: 10_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n };

/** A client that can deploy rule contracts (the SDK's popcorn() extension on a wallet client). */
export interface RuleDeployer {
  deployRule: (o: never) => Promise<{ ruleContract: Address; logic: Address; args: RuleContractArgs; stake?: unknown }>;
}

const send = async (c: DeployClients, to: Address, data: Hex, value = 0n, gas = 3_000_000n): Promise<Hex> => {
  const s = c.wallet.sendTransaction as unknown as (a: Record<string, unknown>) => Promise<Hex>;
  const hash = await s({ to, data, value, gas, account: c.wallet.account, chain: c.wallet.chain });
  const r = await c.pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  return hash;
};

export const deployPoseidon2 = (c: DeployClients) => deployCode(c, poseidon2CreationCode, 20_000_000n);

// ---------------------------------------------------------------- private pool

export const POOL_CAPS = { conditionGas: 260_000, maxVerifyDataLength: 256, maxTriggerDataLength: 160, maxStateGasPerFrame: 4n * 97_920n } as const;

export interface PrivatePoolConfig {
  denomination: bigint;
  /** Who publishes association-set roots. */
  associationProvider: Address;
  fees?: SelfPayingFees;
  stakeAmount?: bigint;
  stakeDelay?: number;
  /** Reuse an existing Poseidon / verifier deployment. */
  poseidon?: Address;
  verifier?: Address;
  /** Wei sent to the pool on creation (pays the stake and the first withdrawals' reserve). */
  fund?: bigint;
}

export interface PrivatePool {
  pool: Address;
  logic: Address;
  poseidon: Address;
  verifier: Address;
  denomination: bigint;
  minFee: bigint;
  args: RuleContractArgs;
}

/** The pool's caps at the given fees, and its minimum fee: the most one withdrawal can cost the pool. */
export function privatePoolCaps(fees: SelfPayingFees = DEFAULT_SELF_PAYING_FEES) {
  const caps = { ...POOL_CAPS, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, maxGasPerFrame: 300_000n };
  const minFee = maxCostPerTrigger({ ...caps, mode: 0 });
  return { caps, minFee };
}

export async function deployPrivatePool(clients: DeployClients, deployer: RuleDeployer, cfg: PrivatePoolConfig): Promise<PrivatePool> {
  const poseidon = cfg.poseidon ?? (await deployPoseidon2(clients)).address;
  const verifier = cfg.verifier ?? (await deployCode(clients, withdrawVerifierBytecode, 8_000_000n)).address;
  const { caps, minFee } = privatePoolCaps(cfg.fees);
  if (minFee > cfg.denomination) throw new Error(`denomination ${cfg.denomination} is below the pool's minimum fee ${minFee} at these fee caps`);
  const stakeAmount = cfg.stakeAmount ?? 100_000_000_000_000_000n;
  const logic = await deployCode(
    clients,
    encodeDeployData({ abi: privatePoolAbi, bytecode: privatePoolBytecode, args: [verifier, poseidon, cfg.denomination, minFee, getAddress(cfg.associationProvider), STAKING_REGISTRY, stakeAmount, cfg.stakeDelay ?? 86_400] }),
    24_000_000n,
  );
  const d = await deployer.deployRule({ logic: logic.address, caps, fund: cfg.fund ?? stakeAmount + 2n * minFee, stake: true } as never);
  return { pool: d.ruleContract, logic: logic.address, poseidon, verifier, denomination: cfg.denomination, minFee, args: d.args };
}

export const poolDeposit = (c: DeployClients, pool: Address, commitment: bigint, denomination: bigint) =>
  send(c, pool, encodeFunctionData({ abi: privatePoolAbi, functionName: "deposit", args: [commitment] }), denomination, 8_000_000n);

export const setAssociationRoot = (c: DeployClients, pool: Address, root: bigint, accepted: boolean) =>
  send(c, pool, encodeFunctionData({ abi: privatePoolAbi, functionName: "setAssociationRoot", args: [root, accepted] }), 0n, 300_000n);

/** Every commitment deposited so far, in order (rebuild the tree with MerkleTree.create(20, leaves)). */
export async function poolCommitments(pub: { getLogs: (a: never) => Promise<{ args: { commitment?: bigint; index?: bigint } }[]> }, pool: Address): Promise<bigint[]> {
  const logs = await pub.getLogs({ address: pool, event: parseAbiItem("event Deposit(uint256 indexed commitment, uint256 index, uint256 root)"), fromBlock: 0n } as never);
  return logs.sort((a, b) => Number((a.args.index ?? 0n) - (b.args.index ?? 0n))).map((l) => l.args.commitment!);
}

/** triggerData and verifyData of a withdrawal. */
export function poolWithdrawal(w: { nullifierHash: bigint; root: bigint; assocRoot: bigint; recipient: Address; fee: bigint; proof: Hex }) {
  return {
    triggerData: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }], [w.nullifierHash, w.root, w.assocRoot, getAddress(w.recipient), w.fee]),
    verifyData: w.proof,
  };
}

// ---------------------------------------------------------------- stealth

/** A receiver's keys. Publish `metaAddress` (ML-KEM public key ++ spending tag); keep the rest secret. */
export interface StealthKeys {
  kemPublicKey: Uint8Array;
  kemSecretKey: Uint8Array;
  spendSecret: bigint;
  spendTag: bigint;
}

/** spendTag must be Poseidon(spendSecret) (from @popcorn/zk: `await poseidon(spendSecret)`). */
export function stealthKeys(spendSecret: bigint, spendTag: bigint, seed?: Uint8Array): StealthKeys {
  const k = ml_kem768.keygen(seed);
  return { kemPublicKey: k.publicKey, kemSecretKey: k.secretKey, spendSecret, spendTag };
}

export const stealthMetaAddress = (k: Pick<StealthKeys, "kemPublicKey" | "spendTag">): Hex => concat([bytesToHex(k.kemPublicKey), encodeAbiParameters([{ type: "uint256" }], [k.spendTag])]);

function parseMeta(meta: Hex): { kemPublicKey: Uint8Array; spendTag: bigint } {
  const b = hexToBytes(meta);
  if (b.length !== 1184 + 32) throw new Error("stealth meta-address must be an ML-KEM-768 public key (1,184 bytes) followed by the 32-byte spending tag");
  return { kemPublicKey: b.slice(0, 1184), spendTag: BigInt(bytesToHex(b.slice(1184))) };
}

/** The field element and view tag a shared secret gives. */
export function sharedToField(sharedSecret: Uint8Array): { shared: bigint; viewTag: number } {
  const h = keccak256(sharedSecret);
  return { shared: BigInt(h) % FIELD, viewTag: Number(BigInt(keccak256(concat([h, "0x76696577"]))) >> 248n) };
}

/**
 * Payer side: encapsulate to the receiver's ML-KEM key. Returns what to pass to StealthVault.pay. `commitmentOf` is
 * Poseidon(spendTag, shared) (from @popcorn/zk: `(t, s) => stealthCommitment(t, s)`).
 */
export async function prepareStealthPayment(meta: Hex, commitmentOf: (spendTag: bigint, shared: bigint) => Promise<bigint>) {
  const { kemPublicKey, spendTag } = parseMeta(meta);
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(kemPublicKey);
  const { shared, viewTag } = sharedToField(sharedSecret);
  return { commitment: await commitmentOf(spendTag, shared), viewTag, ciphertext: bytesToHex(cipherText) };
}

/** Receiver side: which announcements are mine, and the shared secret to spend each. */
export async function scanStealth(
  keys: StealthKeys,
  announcements: { commitment: bigint; viewTag: number; ciphertext: Hex }[],
  commitmentOf: (spendTag: bigint, shared: bigint) => Promise<bigint>,
): Promise<{ commitment: bigint; shared: bigint }[]> {
  const mine: { commitment: bigint; shared: bigint }[] = [];
  for (const a of announcements) {
    let ss: Uint8Array;
    try {
      ss = ml_kem768.decapsulate(hexToBytes(a.ciphertext), keys.kemSecretKey);
    } catch {
      continue;
    }
    const { shared, viewTag } = sharedToField(ss);
    if (viewTag !== a.viewTag) continue;
    if ((await commitmentOf(keys.spendTag, shared)) === a.commitment) mine.push({ commitment: a.commitment, shared });
  }
  return mine;
}

export const STEALTH_CAPS = { conditionGas: 230_000, maxVerifyDataLength: 256, maxTriggerDataLength: 96, maxStateGasPerFrame: 4n * 97_920n } as const;

export function stealthVaultCaps(fees: SelfPayingFees = DEFAULT_SELF_PAYING_FEES) {
  const caps = { ...STEALTH_CAPS, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, maxGasPerFrame: 300_000n };
  return { caps, minFee: maxCostPerTrigger({ ...caps, mode: 0 }) };
}

export async function deployStealthVault(clients: DeployClients, deployer: RuleDeployer, cfg: { fees?: SelfPayingFees; stakeAmount?: bigint; stakeDelay?: number; verifier?: Address; fund?: bigint } = {}) {
  const verifier = cfg.verifier ?? (await deployCode(clients, stealthVerifierBytecode, 8_000_000n)).address;
  const { caps, minFee } = stealthVaultCaps(cfg.fees);
  const stakeAmount = cfg.stakeAmount ?? 100_000_000_000_000_000n;
  const logic = await deployCode(clients, encodeDeployData({ abi: stealthVaultAbi, bytecode: stealthVaultBytecode, args: [verifier, minFee, STAKING_REGISTRY, stakeAmount, cfg.stakeDelay ?? 86_400] }), 24_000_000n);
  const d = await deployer.deployRule({ logic: logic.address, caps, fund: cfg.fund ?? stakeAmount + 2n * minFee, stake: true } as never);
  return { vault: d.ruleContract, logic: logic.address, verifier, minFee, args: d.args };
}

export const stealthPay = (c: DeployClients, vault: Address, p: { commitment: bigint; viewTag: number; ciphertext: Hex }, value: bigint) =>
  send(c, vault, encodeFunctionData({ abi: stealthVaultAbi, functionName: "pay", args: [p.commitment, p.viewTag, p.ciphertext] }), value, 4_000_000n);

/** Announcements from the vault's logs. */
export async function stealthAnnouncements(pub: { getLogs: (a: never) => Promise<{ args: { commitment?: bigint; viewTag?: number; ciphertext?: Hex } }[]> }, vault: Address) {
  const logs = await pub.getLogs({ address: vault, event: parseAbiItem("event Announcement(uint256 indexed commitment, uint8 viewTag, bytes ciphertext, uint256 amount)"), fromBlock: 0n } as never);
  return logs.map((l) => ({ commitment: l.args.commitment!, viewTag: Number(l.args.viewTag!), ciphertext: l.args.ciphertext! }));
}

export function stealthSpend(s: { commitment: bigint; recipient: Address; fee: bigint; proof: Hex }) {
  return { triggerData: encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }], [s.commitment, getAddress(s.recipient), s.fee]), verifyData: s.proof };
}
