// rule sets (AND / OR / NOT / k-of-n trees, value leaves, if/else rules). Contracts: contracts/src/rules.
export * from "./spec.ts";
export {
  RULESET_LIMITS,
  RuleSetInvalid,
  assignSlots,
  decodeRuleSet,
  encodeRuleSet,
  encodeRuleSetUnchecked,
  encodeSource,
  layoutRuleSet,
  validateConfig,
  validateRuleSet,
  type NodeInfo,
  type RuleLayout,
} from "./encode.ts";
export { RULESET_GAS_MODEL, estimateRuleGas, type RuleGas } from "./gas.ts";
export { decodeWitness, encodeWitness, hintsFromResults, orHint, triggerDataFor, predicateContext, type WitnessEntry } from "./witness.ts";
export { ruleSetAbi, explainRule, nodeLabel, readRuleSet, witnessFor, type ExplainOptions, type NodeReport, type NodeVerdict, type RuleExplanation } from "./explain.ts";
export { deployRuleSet, ruleContractCapsFor, leafClass, planRuleSet, ruleClasses, treeClass, type DeployRuleSetOptions, type DeployRuleSetResult, type LeafClass, type PlanOptions, type RuleSetPlan } from "./deploy.ts";
export { ruleSetRuleContractAbi, ruleSetRuleContractBytecode } from "./../artifacts/ruleset.generated.ts";
export { CREATE2_PROXY, RULESET_SALT, ensureRuleSetInfrastructure, predictRuleSetInfrastructure, publishRuleSet, type PublishResult, type RuleSetInfra } from "./infra.ts";
export { ruleSetLogicAbi, ruleSetLogicBytecode, ruleSetPublisherAbi, ruleSetPublisherBytecode } from "../artifacts/ruleset.generated.ts";
