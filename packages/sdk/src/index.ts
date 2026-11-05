// @popcorn/sdk.
// public API: popcorn() viem extension (deployRule, canTrigger, trigger, simulate, watch) for rule-pays rule contracts;
// caller-pays rule contracts (trigger/simulate/canTrigger with { payer, tail }), deployRule({ mode: "callerPays", stake }), stakeRule.
// surface (types, encoder, transport, watch) is unchanged below.
export * from "./types.ts";
export * from "./errors.ts";
export {
  arbitraryEntry,
  parseFrameTx,
  serializeFrameTx,
  signatureHash,
  signSecp256k1Entry,
  txHash,
  type HashSigner,
  type SerializeOptions,
  type SignEntryOptions,
} from "./encoder.ts";
export {
  assertValidFrameTx,
  validateFrameTx,
  EXPIRY_DATA_LENGTH,
  EXPIRY_VERIFIER,
  FRAME_TX_MAX_FRAMES,
  FRAME_TX_MAX_NONCE_KEYS,
  FRAME_TX_MAX_RECENT_ROOT_REFERENCES,
  MAX_BLOBS_PER_TX,
  VERSIONED_HASH_VERSION_KZG,
} from "./validate.ts";
export {
  checkGateway,
  devnetChainId,
  devnets,
  endpointUrl,
  explorerTxUrl,
  getAdmissionStatus,
  getDevnet,
  getNodeTxState,
  getReceipt,
  isGatewayUp,
  parseReceipt,
  parseSimulationResult,
  rpcRequest,
  sendFrameTransaction,
  simulateFrameTransaction,
  toSidecarWire,
  type AdmissionStatus,
  type DevnetConfig,
  type DevnetName,
  type DevnetSelector,
  type FrameReceipt,
  type FrameStatus,
  type FrameTxReceipt,
  type HealthResult,
  type RequestOptions,
  type SendOptions,
  type SimulatedFrame,
  type SimulateOptions,
  type SimulationResult,
  type TransportOptions,
  type Via,
} from "./transport.ts";
export {
  pollStatus,
  watch,
  watchStatuses,
  type FinalWatchStatus,
  type MempoolSource,
  type PollResult,
  type SourceError,
  type UnavailableSource,
  type WatchOptions,
  type WatchStatus,
} from "./watch.ts";

// ---------------------------------------------------------------- client
export { popcorn, type PopcornActions } from "./popcorn.ts";
export {
  coreCodeFromMessage,
  coreCodeOf,
  coreErrorOf,
  createPopcornContext,
  devnetChain,
  prepareTrigger,
  readinessOf,
  readRuleContract,
  prefixGasOf,
  readStake,
  readStakeConfig,
  resolveVia,
  stakeRule,
  STAKE_TRIGGER_DATA,
  type StakeResult,
  type DeployRuleOptions,
  type DeployRuleResult,
  type FeeStrategy,
  type CanTriggerResult,
  type RuleContractInfo,
  type LogicSpec,
  type PopcornConfig,
  type PopcornContext,
  type TriggerFees,
  type TriggerOptions,
  type TriggerResult,
  type TriggerSendOptions,
  type PreparedTrigger,
  type Readiness,
  type SimulateOptions as TriggerSimulateOptions,
  type SimulateResult as TriggerSimulateResult,
} from "./actions.ts";
/** Context-level functions (ctx, ...args), for use without a viem client extension. */
export * as popcornActions from "./actions.ts";
export {
  ARGS_LENGTH,
  DEFAULT_CAPS,
  FACTORY_BOUNDS,
  STATE_SLOT_GAS,
  ZERO_ADDRESS,
  buildTriggerTx,
  buildCallerPaysTriggerTx,
  DEFAULT_PAYER_GAS_LIMIT,
  EOA_PAYER_SIG_GAS,
  PAYER_FRAME_GAS,
  PAYER_PLACEHOLDER_MSG,
  PUBLIC_PREFIX_BUDGET,
  prefixGasAtCaps,
  CALLER_PAYS_MANDATORY_GAS,
  checkRuleContractArgsLocal,
  decodeRuleContractArgs,
  defaultRuleContractArgs,
  encodeRuleContractArgs,
  maxCostOf,
  maxCostPerTrigger,
  maxGasPerTrigger,
  minTxExecutionGas,
  parseRuleContractCode,
  triggerCalldata,
  triggerCalldataLength,
  totalGasLimit,
  verifyFloor,
  verifyFloorAtCaps,
  type CapDefaultsInput,
  type RuleContractArgs,
  type RuleContractCaps,
  type ParsedRule,
  type TriggerTxInput,
  type TriggerTail,
  type CallerPaysTriggerTxInput,
} from "./ruleContract.ts";
export { coreLogicAbi, deriveNonceKey, shadowDelegateCall, shadowInitcode, type RpcFn, type ShadowResult } from "./nonceKey.ts";
export {
  CORE_BUILDS,
  CORE,
  DEFAULT_CORE,
  FACTORY_CORE_CREATION_CODE_HASH,
  deployments,
  getDeployment,
  ruleFactoryAbi,
  ruleFactoryBytecode,
  STAKING_REGISTRY,
  type CoreArtifact,
  type PopcornDeployment,
} from "./deployments.ts";
export { CORE_ERRORS, type CoreErrorInfo } from "./artifacts/coreErrors.generated.ts";

// ---------------------------------------------------------------- hybrid owner (ECDSA + WOTS+)
export {
  KEY_FIRST_USE_GAS,
  LOCAL_OWNER_VERIFY_BUDGET,
  NO_OWNER,
  OWNER_BASE_SLOT,
  OWNER_KEY,
  OWNER_LIMITS,
  OWNER_VERIFY_BASE_GAS,
  PUBLIC_OWNER_VERIFY_BUDGET,
  SEL_OWNER,
  SEL_OWNER_BUMP,
  WOTS_STEP_GAS,
  WotsLeafReused,
  buildOwnerTx,
  encodeOwnerInit,
  fileLeafStore,
  generateHybridKeys,
  hybridSigner,
  loadHybridSigner,
  memoryLeafStore,
  ownerAction,
  ownerCallData,
  ownerPlaceholderEntries,
  readOwnerState,
  type HybridKeyFile,
  type HybridSigner,
  type HybridSignerOptions,
  type LeafStore,
  type OwnerActionOptions,
  type OwnerActionResult,
  type OwnerInit,
  type OwnerState,
  type OwnerTxInput,
  type SignedOwnerTx,
} from "./owner.ts";
export { WOTS_ENTRY_BYTES, WOTS_HEIGHT, WOTS_LEAVES, WOTS_LEN, WOTS_SIG_BYTES, wotsDigits, wotsKeygen, wotsSign, wotsSteps, wotsVerify, type WotsTree } from "./wots.ts";

// simulate() returns { report, text } from @popcorn/simulator; re-exported so callers need one import.
export { readStakeStatus, stakingRegistryOf } from "./stakeStatus.ts";
export { explain, formatReport, toJSON, RULES, type Report, type Finding, type StakeStatus, type SimulateResultLike } from "@popcorn/simulator";

// ---------------------------------------------------------------- signed intents (digest, signers, params and witness encoders)
export * from "./intent.ts";
export * from "./fors.ts";
export * from "./xmss.ts";
export * from "./sphincs.ts";
export * from "./falcon.ts";
// ---------------------------------------------------------------- composition and value triggers (rule sets)
export { publicPrefixBudget, type DevnetBudgets, type EndpointBudget } from "./transport.ts";
// Builders (and, or, not, kOfN, getter, compare, crossing, ...) live in the `ruleset` namespace so they cannot clash with other exports.
export * as ruleset from "./ruleset/index.ts";
export {
  RuleSetInvalid,
  decodeRuleSet,
  deployRuleSet,
  encodeRuleSet,
  explainRule,
  planRuleSet,
  readRuleSet,
  validateRuleSet,
  witnessFor,
  type DeployRuleSetOptions,
  type DeployRuleSetResult,
  type RuleExplanation,
  type RuleSetPlan,
  type RuleSetSpec,
  type RuleSpec,
} from "./ruleset/index.ts";
