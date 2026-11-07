import type { Address, Hex } from "viem";
import type { Flow, Inspection } from "./inspect.ts";
import type { DevnetName } from "./transport.ts";

/** Public demo evidence only. Never put private keys or signing material in this record. */
export interface Incident {
  id: string;
  title: string;
  network: DevnetName;
  chainId: number;
  contracts: { vault: Address; build: Address };
  complete: boolean;
  steps: IncidentStep[];
}

export interface IncidentStep {
  role?: string;
  blockIds?: string[];
  title: string;
  detail: string;
  kind: "ordinary" | "trigger";
  tx: Hex;
  outcome: "success" | "reverted" | "refused";
  block: number | null;
  /** A snapshot read at this block, rather than a historical value guessed later. */
  state?: { block: number; assets: string; shares: string; paused: boolean };
  /** Pre-submit evaluation, explicitly kept separate from the inclusion-derived flow. */
  beforeFlow?: Flow;
  inspection?: Inspection;
  raw?: Hex;
}
