// popcorn(): the viem client extension.
//
//   const client = createWalletClient({ account, chain: devnetChain(), transport: http() }).extend(popcorn());
//   const { rule contract } = await client.deployRule({ logic: { bytecode }, fund: parseEther("0.01") });
//   const hash = await client.trigger(rule contract, { triggerData: "0x01" });
//   await client.watch(hash);
//
// Works on any viem client. Only deployRule needs an account; trigger/canTrigger/simulate/watch work on a client with no
// account for rule-pays rule contracts (triggers carry no signature and the rule contract pays). Caller-pays rule contracts (Core mode 1)
// take { payer: localAccount } in trigger/canTrigger/simulate: the payer signs and pays, and gets any CallerPays reward.
import type { Account, Address, Chain, Client, Hex, Transport } from "viem";
import {
  createPopcornContext,
  deployRule,
  canTrigger,
  trigger,
  triggerDetailed,
  readRuleContract,
  resolveVia,
  simulate,
  stakeRule,
  watch,
  type DeployRuleOptions,
  type DeployRuleResult,
  type CanTriggerResult,
  type RuleContractInfo,
  type PopcornConfig,
  type PopcornContext,
  type TriggerOptions,
  type TriggerResult,
  type TriggerSendOptions,
  type SimulateOptions,
  type SimulateResult,
  type StakeResult,
} from "./actions.ts";
import type { HashSigner } from "./encoder.ts";
import { ownerAction, readOwnerState, type HybridSigner, type OwnerActionOptions, type OwnerActionResult, type OwnerState } from "./owner.ts";
import { explorerTxUrl, type Via } from "./transport.ts";
import type { FinalWatchStatus, WatchOptions } from "./watch.ts";

// A type alias (not an interface): viem's client.extend() needs an index-signature-compatible object type.
export type PopcornActions = {
  /** Deploys the logic (if bytecode is given) and a rule contract through RuleFactory. Needs an account. */
  deployRule(o: DeployRuleOptions): Promise<DeployRuleResult>;
  /** Simulates the exact trigger on ethrex; { ready, code, name, reason, ... }. Sends nothing. */
  canTrigger(ruleContract: Address, o?: TriggerOptions): Promise<CanTriggerResult>;
  /** Builds, checks and submits a trigger; returns its hash. Throws RuleContractNotReady without sending. No account needed. */
  trigger(ruleContract: Address, o?: TriggerSendOptions): Promise<Hex>;
  /** trigger() returning the prepared tx and route as well. */
  triggerDetailed(ruleContract: Address, o?: TriggerSendOptions): Promise<TriggerResult>;
  /** Raw verdicts for the trigger trigger() would send: ethrex simulate + local sidecar. */
  simulate(ruleContract: Address, o?: SimulateOptions): Promise<SimulateResult>;
  /** Follows a tx to included / dropped. */
  watch(hash: Hex, o?: WatchOptions): Promise<FinalWatchStatus>;
  /** Runs the rule contract's built-in stake trigger and waits for it (caller-pays: pass the payer). */
  stakeRule(ruleContract: Address, o?: { payer?: HashSigner; via?: Via | "auto"; timeoutMs?: number }): Promise<StakeResult>;
  /** runs `call` (an encoded onlyOwnerCall function) on the rule contract with the hybrid owner's ECDSA + WOTS+ signatures. */
  ownerAction(ruleContract: Address, call: Hex, signer: HybridSigner, o?: OwnerActionOptions): Promise<OwnerActionResult>;
  /** the rule contract's owner slots (ecdsa, wotsIndex, root, seed) and the owner key's nonce sequence. */
  readOwnerState(ruleContract: Address): Promise<OwnerState>;
  /** Rule contract args (from its code), balance, minimum operating balance. */
  readRuleContract(ruleContract: Address): Promise<RuleContractInfo>;
  /** The route trigger() would use now ("auto" → gateway if healthy, else rpc). */
  popcornRoute(): Promise<Via>;
  /** Explorer link for a tx on this devnet. */
  explorerUrl(hash: Hex): string;
  /** The resolved config (devnet, factory, Core build...). */
  popcorn: PopcornContext;
};

export function popcorn(config: PopcornConfig = {}) {
  return <T extends Transport, C extends Chain | undefined, A extends Account | undefined>(client: Client<T, C, A>): PopcornActions => {
    const ctx = createPopcornContext(config, client as unknown as PopcornContext["client"]);
    return {
      deployRule: (o) => deployRule(ctx, o),
      canTrigger: (k, o) => canTrigger(ctx, k, o),
      trigger: (k, o) => trigger(ctx, k, o),
      triggerDetailed: (k, o) => triggerDetailed(ctx, k, o),
      simulate: (k, o) => simulate(ctx, k, o),
      watch: (h, o) => watch(ctx, h, o),
      stakeRule: (k, o) => stakeRule(ctx, k, o),
      ownerAction: (k, c, s, o) => ownerAction(ctx, k, c, s, o),
      readOwnerState: (k) => readOwnerState(ctx, k),
      readRuleContract: (k) => readRuleContract(ctx, k),
      popcornRoute: () => resolveVia(ctx),
      explorerUrl: (h) => explorerTxUrl(h, ctx.devnet),
      popcorn: ctx,
    };
  };
}
