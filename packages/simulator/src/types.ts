// Input and output types of the simulator. Pure data: no network, no viem.

/**
 * The ONE definition of the verdict data `simulate()` returns. The SDK's `SimulateResult` extends it (narrowing the
 * numeric fields to bigint, `tx` to its FrameTx, and adding `report` and `text`); `explain()` takes it. Numeric
 * fields accept bigint (the SDK), number or decimal string (a JSON round trip).
 */
export type Num = bigint | number | string;

/** Staking-registry status of the rule contract (read by the SDK from the devnet's registry). */
export interface StakeStatus {
  registry: string;
  /** registry.getDepositInfo(ruleContract).stake, in wei. */
  stake: Num;
  /** The stake is enough for the alt mempool's staked budgets (stake > 0). */
  isStaked: boolean;
}

export type Network = "devnet1" | "local";

export interface SimulateResultLike {
  hash?: string;
  raw?: string;
  /** The built frame transaction (the SDK's FrameTx); the explainer ignores it. */
  tx?: unknown;
  nonceKey?: Num;
  /** The declared frame-0 (VERIFY) gas limit; the public prefix budget is checked against it. */
  verifyGasLimit?: Num;
  floor?: Num;
  ethrex: {
    valid: boolean;
    executionStatus: "success" | "reverted" | string | null;
    canonicalMempoolValid: boolean;
    canonicalMempoolViolation: string | null;
    error: string | null;
    /** `0x…` 32-byte Core code when VERIFY reverted. */
    revertData: string | null;
    /** Frame-0 gas actually used. */
    verifyGas: Num | null;
    gasUsed: Num | null;
    maxCost: Num | null;
  };
  /** Local sidecar verdict; null when disabled or unreachable (see sidecarError). */
  sidecar: { admitted: boolean; code: number | null; message: string } | null;
  sidecarError?: string;
  coreError?: { code: number; name: string; check: string };
  ruleContractBalance: Num;
  minOperatingBalance: Num;
  maxCost: Num;
  /** Caller-pays: the payer (null/absent in rule-pays) and its balance; the balance rule then checks the payer. */
  payer?: string | null;
  payerBalance?: Num | null;
  /** Prefix gas as the mempool budgets count it (declared VERIFY limits + signature cost). */
  prefixGas?: Num;
  warning?: string;
  /** Which devnet's budgets apply (public 100k devnet1 / 250k local). explain()'s option wins. */
  network?: Network;
  /** The rule contract's stake; null/absent = unknown. */
  stake?: StakeStatus | null;
}

export type RuleSource = "core" | "ethrex" | "sidecar" | "sdk";
export type Severity = "blocks" | "warns";
export type MempoolScope = "public" | "alt" | "both";

/** A Core revert word (`core`), a regex over a rejection message (`re`), or a catch-all (`fallback`). */
export type Matcher = { core: number } | { re: RegExp } | { fallback: true };

export interface Rule {
  /** e.g. "CORE_0x22", "SIDECAR_BUDGET_010", "ETHREX_STORAGE_READ_NON_SENDER". */
  id: string;
  source: RuleSource;
  matcher: Matcher;
  /** At most 8 words. */
  title: string;
  /** Short clause for the verdict line ("reads another contract's storage"). */
  short: string;
  /** One plain-English sentence: what happened. */
  sentence: string;
  /** One actionable sentence. */
  fix: string;
  severity: Severity;
  mempool: MempoolScope;
}

export interface Finding {
  rule: string;
  source: RuleSource;
  title: string;
  short: string;
  sentence: string;
  fix: string;
  severity: Severity;
  /** Where it was observed: the public mempool (ethrex), the alt mempool (sidecar), or both. */
  mempool: MempoolScope;
  /** Raw strings / numbers this finding was derived from. */
  evidence: string;
}

export interface Verdict {
  /** true = accepted, false = rejected, null = could not be determined (no sidecar verdict). */
  ok: boolean | null;
  /** true when `ok` is derived (ethrex + stake + budgets) because the sidecar was not asked. */
  predicted?: boolean;
  headline: string;
  /** Rule ids of the blocking findings behind a NO. */
  rules: string[];
}

export interface Report {
  publicMempool: Verdict;
  altMempool: Verdict;
  /** Blocking findings (severity "blocks"), alt-mempool ones first. */
  findings: Finding[];
  /** Non-blocking findings. */
  warnings: Finding[];
  /** One line: "accepted by both", "alt mempool only", "rejected by both", ... */
  summary: string;
}

export interface ExplainOptions {
  /** Picks the public VERIFY prefix budget: devnet1 100,000 (default), local 250,000. */
  network?: Network;
}
