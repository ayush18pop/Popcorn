// Shared by the signed-intent network tests (local devnet only): deploys predicates, blobs and rule contracts, runs one signed trigger per scheme and records
// the measurements (VERIFY gas, canonical verdict, sidecar admission, inclusion) in test/results/intent.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeDeployData, http, parseEther, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  InsufficientRuleContractBalance,
  NotAdmitted,
  assertValidParams,
  deployCode,
  deployParamsBlob,
  devnetChain,
  getDevnet,
  getReceipt,
  popcorn,
  type IntentBinding,
} from "../src/index.ts";

export const ROOT = new URL("../../../", import.meta.url).pathname;
export const RESULTS = new URL("./results/", import.meta.url).pathname;
export const WANTED = process.env.POPCORN_NETWORK === "1";
export const KEYS_DIR = process.env.POPCORN_KEYS_DIR ?? `${ROOT}devnet/keys`;
const REGISTRY: Address = "0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F";
export const chain = devnetChain("local");
export const devnet = getDevnet("local");

export async function chainUp(): Promise<boolean> {
  try {
    const r = await fetch(devnet.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    return ((await r.json()) as { result?: string }).result === "0x53a";
  } catch {
    return false;
  }
}

export const keyFile = (n: number) => `${KEYS_DIR}/dev-${n}.json`;
export const loadKey = (n: number): Hex => (JSON.parse(readFileSync(keyFile(n), "utf8")) as { private_key: Hex }[])[0]!.private_key;
export const artifact = (name: string, file = name): { abi: Abi; bytecode: Hex } => {
  const j = JSON.parse(readFileSync(`${ROOT}contracts/out/${file}.sol/${name}.json`, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: j.abi, bytecode: j.bytecode.object };
};
export const j = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

export interface Rows {
  [k: string]: unknown;
}
export const results: Record<string, unknown> = { at: new Date().toISOString(), chain: "local (1338)", rows: [] as Rows[] };
export const saveResults = (name = "intent.json") => {
  mkdirSync(RESULTS, { recursive: true });
  const prior = existsSync(`${RESULTS}${name}`) ? (JSON.parse(readFileSync(`${RESULTS}${name}`, "utf8")) as { rows?: Rows[] }) : {};
  const merged = { ...results, rows: [...(prior.rows ?? []).filter((r) => !(results.rows as Rows[]).some((n) => n.scheme === r.scheme && n.variant === r.variant)), ...(results.rows as Rows[])] };
  writeFileSync(`${RESULTS}${name}`, JSON.stringify(j(merged), null, 2) + "\n");
};

export function makeClients(deployerKey: Hex) {
  const account = privateKeyToAccount(deployerKey);
  const pub = createPublicClient({ chain, transport: http() });
  const deployer = createWalletClient({ account, chain, transport: http() }).extend(popcorn({ devnet }));
  /** A fresh key that never holds ETH: the triggerer. */
  const freshTriggerer = () => {
    const a = privateKeyToAccount(generatePrivateKey());
    return { account: a, client: createWalletClient({ account: a, chain, transport: http() }).extend(popcorn({ devnet })) };
  };
  return { account, pub, deployer, freshTriggerer };
}
export type Clients = ReturnType<typeof makeClients>;

const predicateCache = new Map<string, Address>();
export async function predicateAddress(c: Clients, name: string, ctorArgs: { abi: Abi; args: readonly unknown[] } | null = null): Promise<Address> {
  const hit = predicateCache.get(name);
  if (hit) return hit;
  const a = artifact(name);
  const data = ctorArgs ? encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args: ctorArgs.args as unknown[] }) : a.bytecode;
  const d = await deployCode({ wallet: c.deployer, pub: c.pub }, data, 24_000_000n);
  predicateCache.set(name, d.address);
  return d.address;
}

export interface RuleContractSpec {
  /** artifact of the predicate contract (unused with `inline`) */
  predicate: string;
  params: Hex;
  /** an inline-trigger rule contract (contracts/src/test/IntentCounters.sol): no predicate, no blob; the key is in the constructor args */
  inline?: { name: string; args: unknown[] };
  conditionGas: number;
  maxVerifyDataLength: number;
  /** contracts/src/test/IntentTestRule (stakeable) or the plain example */
  logic?: "SignedIntentCounter" | "IntentTestRule";
  stake?: boolean;
  /** extra forge artifacts the predicate constructor needs etc. */
  predicateAddress?: Address;
  /** reuse an already deployed logic + predicate + blob (a second rule contract with the same rules) */
  reuse?: Pick<DeployedRule, "logic" | "predicate" | "blob">;
}

export interface DeployedRule {
  ruleContract: Address;
  predicate: Address;
  blob: Address;
  logic: Address;
  staked: boolean;
}

/** Deploys the predicate (cached per name), a params blob, the logic and a funded rule contract; optionally stakes it. */
export async function deployIntentRuleContract(c: Clients, s: RuleContractSpec): Promise<DeployedRule> {
  const a = s.inline ? artifact(s.inline.name, "IntentCounters") : artifact(s.logic ?? (s.stake ? "IntentTestRule" : "SignedIntentCounter"));
  const ZERO = "0x0000000000000000000000000000000000000000" as Address;
  if (!s.inline && ["MultisigSigner", "AttestedFactSigner", "WebAuthnSigner"].includes(s.predicate)) await assertValidParams(c.pub as never, await predicateAddress(c, s.predicate), s.params); // distinct keys, bounds, rpIdHash
  const predicate = s.inline ? ZERO : (s.reuse?.predicate ?? s.predicateAddress ?? (await predicateAddress(c, s.predicate)));
  const blob = s.inline ? { address: ZERO } : s.reuse ? { address: s.reuse.blob } : await deployParamsBlob({ wallet: c.deployer, pub: c.pub }, s.params);
  const logic = s.reuse
    ? { address: s.reuse.logic }
    : await deployCode({ wallet: c.deployer, pub: c.pub }, encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args: s.inline ? s.inline.args : [predicate, blob.address] }), 24_000_000n);
  const caps = { conditionGas: s.conditionGas, maxVerifyDataLength: s.maxVerifyDataLength, maxTriggerDataLength: 64 };
  let required = 0n;
  try {
    await c.deployer.deployRule({ logic: logic.address, caps, fund: 0n });
  } catch (e) {
    if (e instanceof InsufficientRuleContractBalance) required = e.required;
    else throw e;
  }
  const d = await c.deployer.deployRule({ logic: logic.address, caps, fund: required * 3n + (s.stake ? parseEther("0.02") : 0n) });
  if (s.stake) {
    const txHash = await c.deployer.writeContract({ address: d.ruleContract, abi: a.abi, functionName: "stakeSelf", args: [86_400], value: parseEther("0.011"), gas: 400_000n });
    const r = await c.pub.waitForTransactionReceipt({ hash: txHash });
    if (r.status !== "success") throw new Error(`stakeSelf reverted: ${txHash}`);
  }
  return { ruleContract: d.ruleContract, predicate, blob: blob.address, logic: logic.address, staked: !!s.stake };
}

export const triggerDataFor = (rule: bigint, amount: bigint): Hex => encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [rule, amount]);
export const bindingFor = (ruleContract: Address, ruleId: bigint, ruleEpoch: bigint, triggerData: Hex): IntentBinding => ({ chainId: BigInt(chain.id), ruleContract, ruleId, ruleEpoch, triggerData });

export interface TriggerMeasure {
  scheme: string;
  variant?: string;
  ruleContract: Address;
  witnessBytes: number;
  verifyGasSimulated: string | null;
  verifyGasReceipt: string | null;
  verifyLimit: string;
  prefixGas: string;
  canonicalMempoolValid: boolean;
  canonicalViolation: string | null;
  readiness: string;
  fits100kPrefix: boolean;
  route: string;
  hash: Hex | null;
  state: string;
  admission: string;
  staked: boolean;
  triggererBalanceAfter: string;
  totalGas: string | null;
}

/** simulate (ethrex, no send) then submit through the gateway (the patched sidecar's admission, auto-bundled) from a 0-ETH key; waits for inclusion. */
export async function triggerAndMeasure(
  c: Clients,
  k: DeployedRule,
  scheme: string,
  triggerData: Hex,
  witness: Hex,
  opts: { variant?: string; tight?: boolean; via?: "rpc" | "gateway"; fallbackRpc?: boolean } = {},
): Promise<TriggerMeasure> {
  const p = c.freshTriggerer();
  let sim = await p.client.simulate(k.ruleContract, { triggerData, verifyData: witness });
  let limit: bigint | undefined;
  if (opts.tight && sim.ethrex.verifyGas !== null) {
    // declare used + 2,500 instead of the SDK's used + 10% (which would push a trigger that fits 100k over it)
    limit = sim.ethrex.verifyGas + 2_500n > sim.floor ? sim.ethrex.verifyGas + 2_500n : sim.floor;
    sim = await p.client.simulate(k.ruleContract, { triggerData, verifyData: witness, verifyGasLimit: limit });
  }
  const row: TriggerMeasure = {
    scheme,
    ...(opts.variant ? { variant: opts.variant } : {}),
    ruleContract: k.ruleContract,
    witnessBytes: (witness.length - 2) / 2,
    verifyGasSimulated: sim.ethrex.verifyGas === null ? null : String(sim.ethrex.verifyGas),
    verifyGasReceipt: null,
    verifyLimit: String(sim.verifyGasLimit),
    prefixGas: String(sim.prefixGas),
    canonicalMempoolValid: sim.ethrex.canonicalMempoolValid,
    canonicalViolation: sim.ethrex.canonicalMempoolViolation,
    readiness: sim.ethrex.valid ? "valid" : `invalid: ${sim.ethrex.error ?? sim.coreError?.name ?? "?"}`,
    fits100kPrefix: sim.prefixGas <= 100_000n,
    route: opts.via === "rpc" ? "ethrex rpc (public-mempool route)" : "sidecar gateway",
    hash: null,
    state: "not sent",
    admission: "not sent",
    staked: k.staked,
    triggererBalanceAfter: "n/a",
    totalGas: null,
  };
  if (!sim.ethrex.valid) return row;
  const send = async (via: "rpc" | "gateway") => {
    const hash = await p.client.trigger(k.ruleContract, { triggerData, verifyData: witness, ...(limit !== undefined ? { verifyGasLimit: limit } : {}), ...(via === "rpc" ? { via: "rpc" as const } : {}) });
    row.hash = hash;
    row.route = via === "rpc" ? "ethrex rpc (public-mempool route)" : "sidecar gateway";
    const st = await p.client.watch(hash);
    row.state = st.state;
    const rc = await getReceipt(hash, { devnet: "local" });
    if (rc) {
      row.verifyGasReceipt = String(rc.frameReceipts[0]?.gasUsed ?? "");
      row.totalGas = String(rc.gasUsed);
    }
  };
  try {
    await send(opts.via ?? "gateway");
    row.admission = opts.via === "rpc" ? "accepted by ethrex" : "admitted (sidecar gateway)";
  } catch (e) {
    const first = e instanceof NotAdmitted ? `refused: ${e.message}` : `error: ${(e as Error).message}`;
    row.admission = first;
    if (opts.fallbackRpc && e instanceof NotAdmitted) {
      try {
        await send("rpc");
        row.admission = `gateway ${first}; then accepted by ethrex rpc`;
      } catch (e2) {
        row.admission = `gateway ${first}; ethrex rpc: ${(e2 as Error).message}`;
      }
    }
  }
  row.triggererBalanceAfter = String(await c.pub.getBalance({ address: p.account.address }));
  return row;
}
