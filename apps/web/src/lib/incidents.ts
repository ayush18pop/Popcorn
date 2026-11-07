import type { Incident } from "../../../../packages/sdk/src/incident";

const records = import.meta.glob("../../../../examples/incidents/*.json", { import: "default", eager: true }) as Record<string, Incident>;

// An interrupted rehearsal is not a successful demo.
export const INCIDENTS = Object.values(records).filter((incident) => incident.complete);
// All recorded projects participate in the same transaction index as public incidents.
import { PROJECTS } from "./catalog";
import { RUNS } from "./runs";
import type { Flow, Inspection } from "@popcorn/sdk/inspect";
import { memberships, type TraceContext, type TraceStep } from "./trace-model";

const blockIds = (flow?: Flow | null) => [...new Set(flow?.nodes.map((node) => node.blockId).filter(Boolean) ?? [])];
export const TRACES: TraceContext[] = [
  ...INCIDENTS.map((incident): TraceContext => ({
    ...incident, kind: "incident", summary: "The complete recorded sequence: setup, healthy refusal, attack, protection and blocked retry.",
    source: `examples/incidents/${incident.id}.json`,
    steps: incident.steps.map((step) => ({ ...step, role: step.role ?? step.title, ordered: true, flow: step.inspection?.flow ?? undefined, blockIds: step.blockIds ?? blockIds(step.inspection?.flow ?? step.beforeFlow) })),
  })),
  ...PROJECTS.flatMap((project): TraceContext[] => {
    const run = RUNS[project.key];
    if (!run?.recorded) return [];
    const featured = run.steps.find((step) => step.stage === "include");
    const steps: TraceStep[] = (run.story ?? []).map((step) => ({
      tx: step.tx as `0x${string}`, title: step.title, detail: step.title, role: step.role,
      kind: step.flow ? "trigger" : "unknown", outcome: step.status === "success" ? "success" : "reverted", block: step.block,
      flow: step.flow, blockIds: [...new Set([step.module, ...blockIds(step.flow)])], ordered: true,
    }));
    if (featured?.stage === "include" && !steps.some((step) => step.tx === featured.tx)) steps.push({
      tx: featured.tx as `0x${string}`, title: run.title, detail: project.featured, role: "featured transaction", kind: "trigger",
      outcome: featured.status === "success" ? "success" : "reverted", block: featured.block, flow: run.flow ?? undefined, blockIds: blockIds(run.flow), ordered: true,
    });
    const repeated = run.failing.tx ? steps.find((step) => step.tx.toLowerCase() === run.failing.tx!.toLowerCase()) : undefined;
    if (repeated) repeated.attempts = [{ outcome: "refused", detail: `The same transaction bytes also have a recorded refused attempt: ${run.failing.result}. The recording does not give this attempt a separate hash or position.`, flow: run.failing.flow }];
    if (run.failing.tx && !repeated) steps.push({
      tx: run.failing.tx as `0x${string}`, title: "Refused attempt", detail: `The recorded trigger was refused: ${run.failing.result}. No on-chain action ran.`,
      role: "refused attempt", kind: "trigger", outcome: "refused", block: null, flow: run.failing.flow,
      blockIds: blockIds(run.failing.flow), ordered: false,
    });
    return [{ id: `example-${project.group}-${project.id}`, kind: "example", title: project.name, summary: project.problem,
      network: run.network.chainId === 1337 ? "devnet1" : "local", chainId: run.network.chainId, contracts: run.contracts ?? {}, steps,
      source: `examples/${project.group}/${project.id}/run.json` }];
  }),
];
export const traceById = (id: string) => TRACES.find((trace) => trace.id === id);
export const transactionsIn = (hash: string, network?: string) => memberships(TRACES, hash, network);

/** Only facts that the recording actually contains; never labelled as a fresh chain lookup. */
export function savedInspection(hash: string, network: string): Inspection | undefined {
  const member = transactionsIn(hash, network)[0];
  if (!member) return;
  const step = member.step;
  return step.inspection ?? {
    hash: step.tx, foundOn: "nowhere", status: step.outcome === "refused" ? "refused" : step.outcome === "reverted" ? "action-reverted" : "included",
    build: null, payer: null, triggerData: null, verifyData: null, block: step.block, seenAt: null, stages: [], flow: step.flow ?? null, refusal: null,
  };
}
