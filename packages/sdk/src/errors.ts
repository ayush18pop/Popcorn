// Typed errors thrown by the SDK. All extend PopcornError so callers can catch broadly.

export class PopcornError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** serializeFrameTx was given a value that cannot be encoded (bad width, length or range). */
export class FrameTxEncodeError extends PopcornError {}

/** parseFrameTx rejected the bytes (wrong type, malformed or non-canonical RLP, bad field). */
export class FrameTxDecodeError extends PopcornError {}

/** A JSON-RPC endpoint answered with an HTTP error status or could not be reached. */
export class EndpointUnavailable extends PopcornError {
  constructor(
    readonly url: string,
    readonly status: number | null,
    readonly body: string,
    options?: { cause?: unknown },
  ) {
    super(
      status === null
        ? `${url} unreachable: ${body}`
        : `${url} returned HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      options,
    );
  }
}

/** The public gateway answered with HTTP 5xx . */
export class GatewayUnavailable extends EndpointUnavailable {}

/** A JSON-RPC error object `{ code, message, data }`. */
export class RpcError extends PopcornError {
  constructor(
    readonly url: string,
    readonly method: string,
    readonly code: number,
    readonly rpcMessage: string,
    readonly data?: unknown,
  ) {
    super(`${method} @ ${url}: [${code}] ${rpcMessage}`);
  }
}

/** watch() reached its timeout before the tx was included or dropped. */
export class WatchTimeout extends PopcornError {
  constructor(
    readonly txHash: string,
    readonly last: unknown,
    readonly timeoutMs: number,
  ) {
    super(`watch(${txHash}) timed out after ${timeoutMs} ms`);
  }
}

/** A request hit its timeout (per-request or the caller's deadline). */
export class RequestTimeout extends EndpointUnavailable {}

/** HTTP 2xx JSON body with neither `result` nor `error`. */
export class MalformedRpcResponse extends PopcornError {
  constructor(
    readonly url: string,
    readonly method: string,
    readonly body: string,
  ) {
    super(`${method} @ ${url}: JSON-RPC response has neither "result" nor "error": ${body.slice(0, 200)}`);
  }
}

/** The tx may or may not have been accepted: the submit request timed out after it was sent. */
export class SubmitOutcomeUnknown extends PopcornError {
  constructor(
    readonly txHash: string,
    readonly url: string,
    options?: { cause?: unknown },
  ) {
    super(`submit of ${txHash} to ${url} timed out; it may have been accepted (watch the hash)`, options);
  }
}

/** The endpoint returned a hash other than keccak256(raw). */
export class HashMismatch extends PopcornError {
  constructor(
    readonly expected: string,
    readonly actual: unknown,
    readonly via: string,
  ) {
    super(`${via} returned hash ${String(actual)}, expected keccak256(raw) = ${expected}`);
  }
}

/** validateFrameTx found static-rule violations (ethrex validate_static_constraints). */
export class FrameTxInvalid extends PopcornError {
  constructor(readonly issues: string[]) {
    super(`invalid frame tx: ${issues.join("; ")}`);
  }
}

// ---------------------------------------------------------------- rule-pays public API

/** The address's code is not `runtime ++ 101 args` of a Core build the SDK knows (deployments.ts CORE_BUILDS). */
export class NotARuleContract extends PopcornError {
  constructor(readonly address: string) {
    super(`${address} is not a Popcorn rule contract of a known Core build (code is not Core runtime ++ 101 args)`);
  }
}

/**
 * The rule contract would not accept this trigger right now (simulated on ethrex; nothing was sent).
 * `code`/`name` are Core's revert code and its CORE_ERRORS name (e.g. 0x22 CONDITION_FALSE), or null with a non-Core
 * `name` such as NONCE_USED / INVALID.
 */
export class RuleContractNotReady extends PopcornError {
  constructor(
    readonly ruleContract: string,
    readonly code: number | null,
    readonly coreName: string,
    readonly reason: string,
  ) {
    super(`rule contract ${ruleContract} not ready: ${code !== null ? `Core 0x${code.toString(16).padStart(2, "0")} ` : ""}${coreName}: ${reason}`);
  }
}

/** A requested fee is above the rule contract's cap (Core would reject it with 0x12 / 0x13), or the base fee already is. */
export class FeeAboveCap extends PopcornError {
  constructor(
    readonly field: "maxFeePerGas" | "maxPriorityFeePerGas" | "baseFee",
    readonly value: bigint,
    readonly cap: bigint,
  ) {
    super(`${field} ${value} is above the rule contract's cap ${cap}`);
  }
}

/** The submit endpoint rejected the trigger (mempool admission), with its reason. */
export class NotAdmitted extends PopcornError {
  constructor(
    readonly via: string,
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`not admitted by ${via}: ${reason}`, options);
  }
}

/** The rule contract's balance (or the planned fund) is below what a trigger reserves. */
export class InsufficientRuleContractBalance extends PopcornError {
  constructor(
    readonly ruleContract: string,
    readonly balance: bigint,
    readonly required: bigint,
    readonly what: "maxCostPerTrigger" | "thisTrigger",
  ) {
    super(
      what === "maxCostPerTrigger"
        ? `rule contract ${ruleContract}: fund ${balance} wei < minimum operating balance ${required} wei (factory.maxCostPerTrigger); pass a larger fund or allowUnderfunded`
        : `rule contract ${ruleContract}: balance ${balance} wei < this trigger's max cost ${required} wei`,
    );
  }
}

/** factory.checkArgs (eth_call) refused the rule contract args; `error` is the factory's custom error name. */
export class RuleContractArgsRejected extends PopcornError {
  constructor(
    readonly error: string,
    readonly detail: string,
  ) {
    super(`factory.checkArgs refused the rule contract args: ${error}${detail ? ` (${detail})` : ""}`);
  }
}

/** An action that needs an account (deployRule) was called on a client without one. */
export class AccountRequired extends PopcornError {}

/** The derived nonce key could not be computed (logic's __nonceKey reverted in the shadow run). */
export class NonceKeyUnavailable extends PopcornError {}

/** A caller-pays (mode 1) rule contract needs a payer: pass `payer` (an account that signs, or a payer contract's address). */
export class PayerRequired extends PopcornError {
  constructor(readonly ruleContract: string) {
    super(`rule contract ${ruleContract} is caller-pays (Core mode 1): pass { payer } (a local account that signs its VERIFY frame, or a payer contract address)`);
  }
}

/** The payer of a caller-pays trigger cannot cover the trigger's max cost (ethrex reserves it at the payer's APPROVE). */
export class InsufficientPayerBalance extends PopcornError {
  constructor(
    readonly payer: string,
    readonly balance: bigint,
    readonly required: bigint,
  ) {
    super(`payer ${payer}: balance ${balance} wei < this trigger's max cost ${required} wei`);
  }
}
