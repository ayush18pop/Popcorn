// The shared pieces a rule-set rule contract needs on a chain: the RuleSetPublisher and a RuleSetLogic (one per stake amount),
// both deployed through Arachnid's CREATE2 proxy so their addresses depend only on the bytecode (same address on every
// chain and after every local reset). ensureRuleSetInfrastructure deploys what is missing; publishRuleSet publishes a config.
import { concatHex, encodeAbiParameters, encodeFunctionData, getAddress, getCreate2Address, keccak256, toHex, type Address, type Chain, type Client, type Hex, type Transport, type Account } from "viem";
import { sendTransaction, waitForTransactionReceipt } from "viem/actions";
import type { PopcornContext } from "../actions.ts";
import { AccountRequired, PopcornError } from "../errors.ts";
import { ruleSetLogicAbi, ruleSetLogicBytecode, ruleSetPublisherAbi, ruleSetPublisherBytecode } from "../artifacts/ruleset.generated.ts";

export const CREATE2_PROXY: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
/** keccak256("popcorn.ruleset.v1"): the CREATE2 salt of every shared rule-set contract. */
export const RULESET_SALT: Hex = keccak256(toHex("popcorn.ruleset.v1"));

export interface RuleSetInfra {
  publisher: Address;
  logic: Address;
  stakeAmount: bigint;
  /** Hashes of the deployments this call made (empty when everything existed). */
  txHashes: Hex[];
}

const logicInit = (publisher: Address, stakeAmount: bigint): Hex => concatHex([ruleSetLogicBytecode, encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [publisher, stakeAmount])]);

/** The addresses the shared contracts have (or will have) through the CREATE2 proxy. Pure. */
export function predictRuleSetInfrastructure(stakeAmount = 0n): { publisher: Address; logic: Address } {
  const publisher = getCreate2Address({ from: CREATE2_PROXY, salt: RULESET_SALT, bytecode: ruleSetPublisherBytecode });
  const logic = getCreate2Address({ from: CREATE2_PROXY, salt: RULESET_SALT, bytecode: logicInit(publisher, stakeAmount) });
  return { publisher, logic };
}

function account(ctx: PopcornContext) {
  const c = ctx.client;
  if (!c?.account) throw new AccountRequired("deploying the rule-set infrastructure needs a client with an account");
  return { client: c as Client<Transport, Chain | undefined, Account>, account: c.account };
}

async function viaProxy(ctx: PopcornContext, initcode: Hex, gas: bigint): Promise<Hex> {
  const { client, account: acc } = account(ctx);
  const code = await ctx.publicClient.getCode({ address: CREATE2_PROXY });
  if (!code || code === "0x") throw new PopcornError(`the CREATE2 proxy ${CREATE2_PROXY} has no code on ${ctx.devnet.name}: deploy the rule-set contracts by hand and pass their addresses`);
  const hash = await sendTransaction(client, { account: acc, chain: client.chain ?? ctx.chain, to: CREATE2_PROXY, data: concatHex([RULESET_SALT, initcode]), gas } as Parameters<typeof sendTransaction>[1]);
  const r = await waitForTransactionReceipt(ctx.publicClient, { hash, timeout: 180_000 });
  if (r.status !== "success") throw new PopcornError(`rule-set deployment via the CREATE2 proxy failed: ${hash}`);
  return hash;
}

const has = async (ctx: PopcornContext, a: Address) => ((await ctx.publicClient.getCode({ address: a })) ?? "0x") !== "0x";

/** Deploys the publisher and the logic for `stakeAmount` if they do not exist yet. Needs a client with an account. */
export async function ensureRuleSetInfrastructure(ctx: PopcornContext, o: { stakeAmount?: bigint; gas?: { publisher?: bigint; logic?: bigint } } = {}): Promise<RuleSetInfra> {
  const stakeAmount = o.stakeAmount ?? 0n;
  const { publisher, logic } = predictRuleSetInfrastructure(stakeAmount);
  const txHashes: Hex[] = [];
  if (!(await has(ctx, publisher))) txHashes.push(await viaProxy(ctx, ruleSetPublisherBytecode, o.gas?.publisher ?? 16_000_000n));
  if (!(await has(ctx, logic))) txHashes.push(await viaProxy(ctx, logicInit(publisher, stakeAmount), o.gas?.logic ?? 40_000_000n));
  if (!(await has(ctx, publisher)) || !(await has(ctx, logic))) throw new PopcornError("rule-set infrastructure missing after deployment");
  return { publisher, logic, stakeAmount, txHashes };
}

export interface PublishResult {
  pointer: Address;
  /** Set when this call sent the publish transaction. */
  txHash: Hex | null;
  gasUsed: bigint | null;
}

/** Publishes a config (the publisher validates it on chain) and returns its pointer; a config already published costs nothing. */
export async function publishRuleSet(ctx: PopcornContext, publisher: Address, config: Hex, o: { gas?: bigint } = {}): Promise<PublishResult> {
  const pointer = getAddress(await ctx.publicClient.readContract({ address: publisher, abi: ruleSetPublisherAbi, functionName: "predict", args: [config] }));
  if (await has(ctx, pointer)) return { pointer, txHash: null, gasUsed: null };
  const { client, account: acc } = account(ctx);
  const hash = await sendTransaction(client, { account: acc, chain: client.chain ?? ctx.chain, to: publisher, data: encodeFunctionData({ abi: ruleSetPublisherAbi, functionName: "publish", args: [config] }), gas: o.gas ?? 20_000_000n } as Parameters<typeof sendTransaction>[1]);
  const r = await waitForTransactionReceipt(ctx.publicClient, { hash, timeout: 180_000 });
  if (r.status !== "success") throw new PopcornError(`publish reverted: ${hash} (the publisher refuses an invalid config)`);
  return { pointer, txHash: hash, gasUsed: r.gasUsed };
}

export { ruleSetLogicAbi };
