// Recorded runs (examples/<corner>/<module>/run.json, docs/ui-handoff.md "Recorded runs"). The player replays these
// files and nothing else. A file with `recorded: false` is a sample in the recorder's format and is labelled as such.

const files = import.meta.glob("../../../../examples/*/*/run.json", { import: "default", eager: true }) as Record<string, Run>;

export type Stage = "build" | "validate" | "admit" | "include" | "act";
export const STAGES: Stage[] = ["build", "validate", "admit", "include", "act"];
export const STAGE_NAME: Record<Stage, string> = { build: "Build", validate: "Validate", admit: "Admit", include: "Include", act: "Act" };

export interface RunFrame { mode: "VERIFY" | "SENDER" | "DEFAULT"; flags: number; target: string; gasLimit: number; data: string; explain?: string }
export interface RunRead { label: string; value: string; gas: number }
export interface RunCheck { rule: string; verdict: "pass" | "fail" | "warn"; detail: string }

export type RunStep =
  | { stage: "build"; frames: RunFrame[]; world: Record<string, string> }
  | { stage: "validate"; reads: RunRead[]; result: string; gasUsed: number }
  | { stage: "admit"; report: { mempool: string; outcome: "accepted" | "rejected"; entity?: { name: string; staked: boolean; budget: number; used: number }; checks: RunCheck[] } }
  | { stage: "include"; tx: string; block: number; status: string; payer: string; gasUsed: number }
  | { stage: "act"; before: Record<string, string>; after: Record<string, string>; events?: string[] };

export interface Run {
  module: string;
  recorded: boolean;
  note?: string;
  network: { name: string; chainId: number };
  title: string;
  actors: { caller: string; ruleContract: string; payer: string };
  steps: RunStep[];
  failing: { result: string; core?: string; steps: RunStep[] };
  sources: Record<string, string>;
}

/** key: "<corner>/<module dir>" */
export const RUNS: Record<string, Run> = Object.fromEntries(
  Object.entries(files).map(([p, run]) => [p.split("/").slice(-3, -1).join("/"), run]),
);

export const runFor = (key: string | null | undefined) => (key ? RUNS[key] : undefined);

export const step = <S extends Stage>(steps: RunStep[], stage: S) => steps.find((s) => s.stage === stage) as Extract<RunStep, { stage: S }> | undefined;

export const fmt = (n: number) => n.toLocaleString("en-US");
