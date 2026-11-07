import type { Flow, Inspection } from "../../../../packages/sdk/src/inspect";
import type { IncidentStep } from "../../../../packages/sdk/src/incident";

export interface TraceStep extends Omit<IncidentStep, "kind"> {
  kind: "ordinary" | "trigger" | "unknown";
  attempts?: { outcome: "refused"; detail: string; flow?: Flow }[];
  role: string;
  blockIds: string[];
  flow?: Flow;
  /** A refusal without a recorded position must not be presented as a chronological successor. */
  ordered: boolean;
}
export interface TraceContext {
  id: string;
  kind: "incident" | "example";
  title: string;
  summary: string;
  network: "local" | "devnet1";
  chainId: number;
  contracts: Record<string, string>;
  steps: TraceStep[];
  source: string;
}

export function memberships(contexts: TraceContext[], hash: string, network?: string) {
  return contexts.flatMap((context) => {
    if (network && context.network !== network) return [];
    const index = context.steps.findIndex((step) => step.tx.toLowerCase() === hash.toLowerCase());
    return index < 0 ? [] : [{ context, step: context.steps[index]!, index }];
  });
}

export function neighbors(context: TraceContext, step: TraceStep) {
  const sequence = context.steps.filter((item) => item.ordered);
  const i = sequence.indexOf(step);
  return i < 0 ? {} : { previous: sequence[i - 1], next: sequence[i + 1] };
}

export function contractRelations(contexts: TraceContext[], inspection: Pick<Inspection, "hash" | "build" | "transaction">, network: string) {
  const addresses = [inspection.build, inspection.transaction?.to, inspection.transaction?.from].filter(Boolean).map((a) => a!.toLowerCase());
  return contexts.filter((context) => context.network === network
    && !context.steps.some((step) => step.tx.toLowerCase() === inspection.hash.toLowerCase())
    && Object.values(context.contracts).some((address) => addresses.includes(address.toLowerCase())));
}
