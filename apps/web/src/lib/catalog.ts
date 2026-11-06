// The module catalog. docs/catalog/<corner>/<module>.md is the single source: front matter for the facts the site
// filters and badges on, Markdown sections for the page. Nothing here restates a module; it only parses.
import { parse as parseYaml } from "yaml";

const files = import.meta.glob("../../../../docs/catalog/*/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export type CornerId = "pause" | "repay" | "exit" | "payout" | "liquidate" | "gas" | "sign" | "build";
export type Trigger = "invariant" | "market" | "dependency" | "people" | "proof" | "tickets" | "payment" | "tooling";
export type Status = "built" | "planned" | "research";

export interface Corner {
  id: CornerId;
  name: string;
  does: string;
  triggers: Trigger[];
}

/** The eight corners (docs/ui-handoff.md, "The 8 corners"). */
export const CORNERS: Corner[] = [
  { id: "pause", name: "Pause", does: "Stop the protocol or part of it", triggers: ["invariant", "market", "dependency", "people", "proof"] },
  { id: "repay", name: "Repay and Top-Up", does: "Rescue a position before liquidation", triggers: ["invariant"] },
  { id: "exit", name: "Exit", does: "Get funds out before losses", triggers: ["market", "invariant"] },
  { id: "payout", name: "Pay Out", does: "Bounties and rewards", triggers: ["proof", "people"] },
  { id: "liquidate", name: "Liquidate Fairly", does: "One winner, losers pay nothing", triggers: ["tickets"] },
  { id: "gas", name: "Pay Gas", does: "Sponsor gas safely", triggers: ["payment", "invariant", "market"] },
  { id: "sign", name: "Approve and Sign", does: "Who may authorise: signers and wallet validators", triggers: ["people"] },
  { id: "build", name: "Build and Check", does: "Core, conditions, simulator, SDK, devnet", triggers: ["tooling"] },
];

export const TRIGGER_TEXT: Record<Trigger, string> = {
  invariant: "the protocol's own math broke",
  market: "prices, pegs, liquidity",
  dependency: "something it relies on changed",
  people: "signatures",
  proof: "cryptographic evidence",
  tickets: "keyed-nonce tickets",
  payment: "who pays the gas",
  tooling: "build and test",
};

export interface Module {
  id: string;
  name: string;
  corner: CornerId;
  trigger: Trigger;
  status: Status;
  mempool: { public: boolean; alt: "unstaked" | "staked" | "none" };
  gas: { validation: number; tag: "measured" | "estimated"; network: string } | null;
  example: string | null; // e.g. "pause/guarded-vault"
  related: string[];
  code: string[];
  postQuantum: boolean;
  /** Markdown sections by heading ("What it does", "When it fires", ...). */
  sections: Record<string, string>;
  summary: string;
}

function parseFile(path: string, raw: string): Module {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`catalog file without front matter: ${path}`);
  const fm = parseYaml(m[1]) as Record<string, unknown>;
  const id = path.split("/").pop()!.replace(/\.md$/, "");
  const sections: Record<string, string> = {};
  let cur = "";
  for (const line of m[2].split("\n")) {
    const h = /^## (.+)$/.exec(line);
    if (h) {
      cur = h[1];
      sections[cur] = "";
    } else if (cur) sections[cur] += line + "\n";
  }
  for (const k of Object.keys(sections)) sections[k] = sections[k].trim();
  const example = typeof fm.example === "string" ? fm.example.replace(/^examples\//, "").replace(/\/run\.json$/, "") : null;
  return {
    id,
    name: String(fm.name),
    corner: fm.corner as CornerId,
    trigger: fm.trigger as Trigger,
    status: fm.status as Status,
    mempool: fm.mempool as Module["mempool"],
    gas: (fm.gas as Module["gas"]) ?? null,
    example,
    related: (fm.related as string[]) ?? [],
    code: (fm.code as string[]) ?? [],
    postQuantum: Boolean(fm.postQuantum),
    sections,
    summary: sections["What it does"] ?? "",
  };
}

export const MODULES: Module[] = Object.entries(files)
  .map(([p, raw]) => parseFile(p, raw))
  .sort((a, b) => CORNERS.findIndex((c) => c.id === a.corner) - CORNERS.findIndex((c) => c.id === b.corner) || (a.status === b.status ? 0 : a.status === "built" ? -1 : 1) || a.name.localeCompare(b.name));

export const moduleById = (id: string) => MODULES.find((m) => m.id === id);
export const cornerById = (id: string) => CORNERS.find((c) => c.id === id);

export const REPO = "https://github.com/ayush18pop/Popcorn";
export const repoFile = (path: string) => `${REPO}/blob/main/${path}`;
