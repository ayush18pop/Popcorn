// Planning and deploying a rule-set rule contract: rule contract caps derived from the spec, the mempool class of every leaf, and
// deployRuleSet() = deployRule() with the RuleSetContract logic and those caps.
import { parseEther, size, type Address, type Hex } from "viem";
import { deployRule, type DeployRuleOptions, type DeployRuleResult, type PopcornContext } from "../actions.ts";
import { ruleSetRuleContractAbi, ruleSetRuleContractBytecode } from "../artifacts/ruleset.generated.ts";
import { ensureRuleSetInfrastructure, publishRuleSet } from "./infra.ts";
import { PUBLIC_PREFIX_BUDGET, STATE_SLOT_GAS, verifyFloor, type RuleContractCaps } from "../ruleContract.ts";
import { getDevnet, type DevnetSelector } from "../transport.ts";
import { PopcornError } from "../errors.ts";
import { RULESET_LIMITS, childrenOf, encodeRuleSet, layoutRuleSet } from "./encode.ts";
import { RULESET_GAS_MODEL, estimateRuleGas, type RuleGas } from "./gas.ts";
import { DEFAULT_CALL_GAS, type Node, type RuleSetSpec, type Source } from "./spec.ts";

// ---------------------------------------------------------------- mempool class

/** Where a trigger that evaluates this leaf is accepted. */
export interface LeafClass {
  /** Public ethrex / the canonical mempool rules (flat 100k on devnet1, 250k on our local ethrex). */
  publicMempool: boolean;
  /** ERC-8421 sidecar, unstaked entity. */
  unstaked: boolean;
  /** ERC-8421 sidecar, staked entity (always true for the leaves here). */
  staked: boolean;
  reason: string;
}

const OWN: LeafClass = { publicMempool: true, unstaked: true, staked: true, reason: "reads only the rule contract's own storage" };

function sourceClass(s: Source): LeafClass {
  switch (s.kind) {
    case "storage":
      return OWN;
    case "getter":
      return { publicMempool: false, unstaked: false, staked: true, reason: "reads another contract's storage (StorageReadNonSender on ethrex; the sidecar wants a staked entity)" };
    case "ethBalance":
      return { publicMempool: false, unstaked: false, staked: true, reason: "BALANCE / SELFBALANCE are banned opcodes; the sidecar allows them for staked entities only" };
    case "erc20":
      return s.account === "self"
        ? { publicMempool: false, unstaked: true, staked: true, reason: "token.balanceOf(rule contract) is storage associated with the rule contract: the sidecar allows it unstaked, ethrex refuses any foreign storage read" }
        : { publicMempool: false, unstaked: false, staked: true, reason: "token.balanceOf(other) is not storage associated with the rule contract: staked only; ethrex refuses it" };
  }
}

const merge = (a: LeafClass, b: LeafClass): LeafClass => ({
  publicMempool: a.publicMempool && b.publicMempool,
  unstaked: a.unstaked && b.unstaked,
  staked: a.staked && b.staked,
  reason: [a.reason, b.reason].filter((x, i, arr) => x && arr.indexOf(x) === i && x !== OWN.reason).join("; ") || OWN.reason,
});

export function leafClass(n: Node): LeafClass {
  switch (n.type) {
    case "const":
      return OWN;
    case "cmp":
    case "range":
      return sourceClass(n.source);
    case "crossing":
    case "delta":
      return sourceClass(n.source); // the checkpoint is the rule contract's own storage
    case "ratio":
      return merge(sourceClass(n.a), sourceClass(n.b));
    case "codeHash":
      return { publicMempool: true, unstaked: true, staked: true, reason: "EXTCODEHASH is not banned and reads no storage, but only for an account WITH code: an empty account is refused by ethrex (CallToNonexistentOrDelegated) and by the sidecar (un-deployed contract address), so 'code changed to nothing' can never fire (measured, report I1)" };
    case "predicate":
      return { publicMempool: true, unstaked: true, staked: true, reason: "STATICCALL to a predicate that reads no storage (ICondition rule); a predicate that does is classed by what it reads" };
    default:
      return OWN;
  }
}

/** A tree's class is its strictest leaf's (the worst a trigger of it can touch). Nodes a given trigger skips do not count for that trigger. */
export function treeClass(n: Node): LeafClass {
  const kids = childrenOf(n);
  if (kids.length === 0) return leafClass(n);
  return kids.map(treeClass).reduce(merge);
}

export function ruleClasses(spec: RuleSetSpec): LeafClass[] {
  return spec.rules.map((r, i) => {
    let c = treeClass(r.when);
    if (spec.mode === "else") for (let j = 0; j < i; j++) c = merge(c, treeClass(spec.rules[j]!.when));
    return c;
  });
}

// ---------------------------------------------------------------- plan

export interface RuleSetPlan {
  config: Hex;
  configBytes: number;
  gas: RuleGas[];
  /** Rule contract caps that fit every rule (conditionGas, data caps, frame gas, state gas). Any caps passed to the plan win. */
  caps: Required<Pick<RuleContractCaps, "conditionGas" | "maxVerifyDataLength" | "maxTriggerDataLength" | "maxGasPerFrame" | "maxStateGasPerFrame">>;
  classes: LeafClass[];
  /** Worst-case VERIFY limit of a trigger (Core floor at the caps) vs the budgets. */
  verifyFloorAtCaps: bigint;
  warnings: string[];
}

export interface PlanOptions {
  /** The rule contract will stake itself (built-in stake trigger): raises the frame caps to what it needs. */
  stake?: boolean;
  /** Max witness bytes of any one trigger (default: 5 per OR node + each predicate's maxWitnessBytes + 4). */
  maxWitnessBytes?: number;
  caps?: RuleContractCaps;
  /** Budgets to warn against. Default: public 100k, unstaked 250k (or `devnet`'s; an unknown budget is not warned about). */
  budgets?: { public?: bigint | null; unstaked?: bigint | null };
  /** Take the budgets from this devnet's `budgets` (DevnetConfig). */
  devnet?: DevnetSelector;
}

const ACTION_RESERVE = 30_000; // RuleSet.ACTION_RESERVE
const hasStateful = (n: Node): boolean => n.type === "crossing" || n.type === "delta" || childrenOf(n).some(hasStateful);

const witnessBound = (spec: RuleSetSpec): number => {
  let best = 0;
  for (const l of layoutRuleSet(spec)) {
    let b = 0;
    for (const n of l.nodes) {
      if (n.node.type === "or") b += 5;
      if (n.node.type === "predicate") b += 4 + (n.node.maxWitnessBytes ?? 0);
    }
    best = Math.max(best, b);
  }
  return best;
};

export function planRuleSet(spec: RuleSetSpec, o: PlanOptions = {}): RuleSetPlan {
  const config = encodeRuleSet(spec); // throws RuleSetInvalid
  const configBytes = size(config);
  const gas = estimateRuleGas(spec, configBytes);
  const warnings: string[] = [];
  const worstCond = Math.max(...gas.map((g) => g.condition));
  const worstAct = Math.max(...gas.map((g) => g.action));
  const conditionGas = o.caps?.conditionGas ?? Math.max(5_000, Math.ceil(worstCond * RULESET_GAS_MODEL.margin));
  const maxVerifyDataLength = o.caps?.maxVerifyDataLength ?? o.maxWitnessBytes ?? witnessBound(spec);
  const maxTriggerDataLength = o.caps?.maxTriggerDataLength ?? 128;
  const floorAt = verifyFloor({ conditionGas }, maxVerifyDataLength, 68 + Math.ceil(maxTriggerDataLength / 32) * 32);
  const frameGas = BigInt(Math.min(16_777_216, Math.max(200_000, Math.ceil(worstAct * 1.25) + 50_000, o.stake ? 120_000 : 0))); // 16,777,216 = the factory's per-frame bound (EIP-7825)
  const maxGasPerFrame = o.caps?.maxGasPerFrame ?? (frameGas > floorAt ? frameGas : floorAt);
  const slots = Math.max(...gas.map((g) => g.freshSlots), 2, o.stake ? 3 : 0);
  const maxStateGasPerFrame = o.caps?.maxStateGasPerFrame ?? BigInt(slots) * STATE_SLOT_GAS;
  // M1: a CALL's gas is capped at run time to what the frame can afford; a configured cap above that only tells the reader something wrong
  spec.rules.forEach((r, i) => {
    const rp = `rule ${i}${r.name ? ` (${r.name})` : ""}`;
    const a = r.action;
    if (a?.type === "call") {
      const g = BigInt(a.gas ?? DEFAULT_CALL_GAS);
      if (g > maxGasPerFrame - BigInt(ACTION_RESERVE)) warnings.push(`${rp}: action gas ${g} is above maxGasPerFrame ${maxGasPerFrame} minus the ${ACTION_RESERVE} reserve: the call is capped at run time to what the frame can afford`);
    }
    // L2: an unlimited rule re-fires on every trigger while its condition holds
    if ((r.maxFires ?? 1) === 0) {
      if (a?.type === "call" && (a.value ?? 0n) > 0n) warnings.push(`${rp}: maxFires 0 with a CALL that sends value: every trigger while the condition holds pays it again; anyone can drain the rule contract's balance`);
      if (!hasStateful(r.when)) warnings.push(`${rp}: maxFires 0 on a tree with no crossing/delta leaf: it re-fires on every trigger while the condition stays true (the rule contract pays each trigger)`);
    }
  });
  // L4: a predicate without maxWitnessBytes is planned with a 0-byte witness
  layoutRuleSet(spec).forEach((l) => l.nodes.forEach((n) => { if (n.node.type === "predicate" && n.node.maxWitnessBytes === undefined && o.maxWitnessBytes === undefined && o.caps?.maxVerifyDataLength === undefined) warnings.push(`rule ${l.ruleId} node ${n.index}: predicate without maxWitnessBytes: the plan allows no witness bytes beyond the 4-byte entry header, so a trigger carrying a signature or proof is refused (VERIFY_DATA_TOO_LONG); set maxWitnessBytes`); }));
  const dv = o.devnet ? getDevnet(o.devnet).budgets : undefined;
  const fromDevnet = (n: number | null | undefined): bigint | null => (n === undefined || n === null ? null : BigInt(n));
  const budgets = {
    public: o.budgets?.public !== undefined ? o.budgets.public : dv ? fromDevnet(dv.ethrex) : PUBLIC_PREFIX_BUDGET,
    unstaked: o.budgets?.unstaked !== undefined ? o.budgets.unstaked : dv ? fromDevnet(dv.sidecar?.unstaked) : 250_000n,
  };
  if (o.caps?.conditionGas !== undefined && o.caps.conditionGas < worstCond) warnings.push(`conditionGas ${o.caps.conditionGas} is below the worst-case estimate ${worstCond}: a trigger that reaches the expensive reads can fail closed`);
  if (maxStateGasPerFrame < BigInt(Math.max(...gas.map((g) => g.freshSlots))) * STATE_SLOT_GAS) warnings.push("maxStateGasPerFrame is below the state gas the action can need (epoch + checkpoint slots): the first fire of that rule could revert and burn its key");
  if (o.caps?.maxGasPerFrame !== undefined && o.caps.maxGasPerFrame < BigInt(Math.ceil(worstAct))) warnings.push(`maxGasPerFrame ${o.caps.maxGasPerFrame} is below the worst-case action estimate ${worstAct}: an action that runs out of gas reverts and burns its key`);
  if (budgets.unstaked !== null && floorAt > budgets.unstaked) warnings.push(`the VERIFY floor at these caps is ${floorAt}: over the ${budgets.unstaked} unstaked budget (staked only)`);
  else if (budgets.public !== null && floorAt > budgets.public) warnings.push(`the VERIFY floor at these caps is ${floorAt}: over the public ${budgets.public} budget (local/organiser mempools only)`);
  if (maxVerifyDataLength > RULESET_LIMITS.MAX_CONFIG) warnings.push("witness cap over 16 KB");
  return { config, configBytes, gas, caps: { conditionGas, maxVerifyDataLength, maxTriggerDataLength, maxGasPerFrame, maxStateGasPerFrame }, classes: ruleClasses(spec), verifyFloorAtCaps: floorAt, warnings };
}

// ---------------------------------------------------------------- deploy

export interface DeployRuleSetOptions extends Omit<DeployRuleOptions, "logic" | "mode"> {
  plan?: PlanOptions;
  /** Stake locked by the rule contract's built-in stake trigger. Giving it (> 0) makes the rule contract stake-capable (stakeRule() works later);
   *  `stake: true` runs the stake trigger at once (amount defaults to 0.011 ETH). */
  stakeAmount?: bigint;
  /**
   * "shared" (default): publish the config through the RuleSetPublisher (validated on chain) and create the rule contract on the
   * shared RuleSetLogic with the pointer in its `verifier` arg: a few hundred thousand gas. "perConfig": deploy a RuleSetContract
   * logic with the config baked in (about 26M gas of code deposit; the config is validated by its constructor).
   */
  logicKind?: "shared" | "perConfig";
  /** An already deployed logic to use instead (custom Solidity logic extending RuleSet, or a RuleSetContract for this config). */
  logic?: DeployRuleOptions["logic"];
}

export interface DeployRuleSetResult extends DeployRuleResult {
  plan: RuleSetPlan;
  /** Shared logic only: the config's data contract (the rule contract's `verifier` arg) and the publish transaction (null if it already existed). */
  pointer: Address | null;
  publishTx: Hex | null;
  publishGas: bigint | null;
}

/**
 * The rule contract caps deployRuleSet passes to deployRule: the caller's caps (fee caps, anything the plan does not size) under the
 * plan's. On the shared logic the `verifier` is the config pointer, so a caller-supplied one is refused.
 */
export function ruleContractCapsFor(plan: RuleSetPlan, userCaps: RuleContractCaps | undefined, o: { shared: true; pointer: Address } | { shared: false }): RuleContractCaps {
  if (o.shared) {
    if (userCaps?.verifier !== undefined) throw new PopcornError("caps.verifier cannot be set with the shared RuleSetLogic: the rule contract's verifier arg is the config pointer (pass logic or logicKind: \"perConfig\" for another layout)");
    return { ...userCaps, ...plan.caps, verifier: o.pointer };
  }
  return { ...userCaps, ...plan.caps };
}

/**
 * Deploys a rule-set rule contract (rule-pays) with caps from `planRuleSet`. Shared logic (default): ensure the publisher and
 * logic exist, publish the config, create the rule contract with `verifier = pointer`. Needs a client with an account.
 */
export async function deployRuleSet(ctx: PopcornContext, spec: RuleSetSpec, o: DeployRuleSetOptions = {}): Promise<DeployRuleSetResult> {
  // stakeAmount > 0 picks the stake-capable logic and sizes the caps for a stake trigger; `stake: true` also runs it now
  const stakeAmount = o.stakeAmount ?? (o.stake ? parseEther("0.011") : 0n);
  const plan = planRuleSet(spec, { ...(o.plan ?? {}), ...(stakeAmount > 0n ? { stake: true } : {}), ...(o.caps ? { caps: o.caps } : {}) });
  if (stakeAmount > 0n && plan.caps.maxStateGasPerFrame < 3n * STATE_SLOT_GAS) throw new PopcornError("stake needs maxStateGasPerFrame >= 293,760");
  const { plan: _p, stakeAmount: _s, logic, logicKind, ...rest } = o;
  void _p;
  void _s;
  if (logic !== undefined || logicKind === "perConfig") {
    const r = await deployRule(ctx, {
      ...rest,
      logic: logic ?? { abi: ruleSetRuleContractAbi as never, bytecode: ruleSetRuleContractBytecode, args: [plan.config, stakeAmount] },
      caps: ruleContractCapsFor(plan, o.caps, { shared: false }),
      gas: { logic: 40_000_000n, ...(o.gas ?? {}) },
    });
    return { ...r, plan, pointer: null, publishTx: null, publishGas: null };
  }
  if (o.caps?.verifier !== undefined) ruleContractCapsFor(plan, o.caps, { shared: true, pointer: "0x0000000000000000000000000000000000000000" }); // refuse before anything is deployed
  const infra = await ensureRuleSetInfrastructure(ctx, { stakeAmount });
  const pub = await publishRuleSet(ctx, infra.publisher, plan.config);
  const r = await deployRule(ctx, { ...rest, logic: infra.logic, caps: ruleContractCapsFor(plan, o.caps, { shared: true, pointer: pub.pointer }) });
  return { ...r, plan, pointer: pub.pointer, publishTx: pub.txHash, publishGas: pub.gasUsed };
}
