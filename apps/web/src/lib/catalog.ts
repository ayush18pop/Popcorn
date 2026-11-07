// The block catalog and the example projects. docs/catalog/<checks|joins|actions|payers|ready-made>/<id>.md and
// examples/<group>/<id>/project.md are the single sources: front matter for the facts the site filters and badges on,
// Markdown sections for the page.
import { parse as parseYaml } from "yaml";

const files = import.meta.glob("../../../../docs/catalog/*/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const projectFiles = import.meta.glob("../../../../examples/*/*/project.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export type Status = "built" | "planned" | "research";
export type RunsOn = "public" | "alternative" | "alternative-staked";
export type ShapeId = "check" | "join" | "action" | "payer" | "signer";
export type TierId = 1 | 2 | 3;

export const RUNS_ON_TEXT: Record<RunsOn, string> = {
  public: "Public mempool",
  alternative: "Alternative mempool",
  "alternative-staked": "Alternative mempool, staked",
};

export interface Shape {
  id: ShapeId;
  name: string;
  /** Plural, for filters and headings. */
  plural: string;
  does: string;
}

/** The four block shapes. A build is a payer, checks joined together, and actions. */
export const SHAPES: Shape[] = [
  { id: "check", name: "Condition", plural: "Conditions", does: "Returns YES, NO or UNKNOWN. UNKNOWN never fires." },
  { id: "join", name: "Logic operator", plural: "Logic operators", does: "Combines conditions: AND, OR, NOT / NOR, K-of-N, EXACTLY ONE, IF / ELSE." },
  { id: "action", name: "Action", plural: "Actions", does: "Does one thing when the conditions return YES." },
  { id: "payer", name: "Gas payer", plural: "Gas payers", does: "Decides who pays the gas." },
  { id: "signer", name: "Signer", plural: "Signers", does: "Key types for the Signature condition; the post-quantum ones are marked." },
];
export const shapeById = (id: string) => SHAPES.find((s) => s.id === id);

export const TIERS: { id: TierId; title: string; sub: string }[] = [
  { id: 1, title: "Core", sub: "The minimum for any build: a gas payer, a condition, an action, and the logic operators." },
  { id: 2, title: "Common", sub: "What most real builds add: proofs, rewards, voting, key recovery, exits." },
  { id: 3, title: "Specialized", sub: "Oracles and attestations, upgrade watching, post-quantum keys, lending." },
];

export interface Block {
  id: string;
  name: string;
  /** "ready-made" for whole builds (Private Pool, Stealth Vault). */
  shape: ShapeId | "ready-made";
  /** Absent for complete contracts. */
  tier: TierId | null;
  status: Status;
  runsOn: RunsOn[];
  gas: { validation?: number; total?: number; tag: "measured" | "estimated"; network: string } | null;
  inputs: { name: string; what: string }[];
  perTrigger: string;
  output: string;
  /** Use cases in three groups: ready to use (a build or example exists), common configurations, other ideas (not built). */
  useCases: { ready: string[]; configs: string[]; ideas: string[] };
  /** A post-quantum scheme (the signers): shown on its card. */
  postQuantum: boolean;
  builtFrom: string[];
  sdk: string | null;
  related: string[];
  code: string[];
  /** Markdown sections by heading ("Overview", "Configuration", "Usage", "Mempool", "Gotchas", ...). */
  sections: Record<string, string>;
  summary: string;
}
/** Older name for a block. */
export type Module = Block;

function split(path: string, raw: string) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`file without front matter: ${path}`);
  return { fm: parseYaml(m[1]!) as Record<string, unknown>, body: m[2]! };
}

function sectionsOf(body: string) {
  const sections: Record<string, string> = {};
  let cur = "";
  let inFence = false;
  for (const line of body.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    const h = !inFence && /^## (.+)$/.exec(line);
    if (h) {
      cur = h[1]!;
      sections[cur] = "";
    } else if (cur) sections[cur] += line + "\n";
  }
  for (const k of Object.keys(sections)) sections[k] = sections[k]!.trim();
  return sections;
}

const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

function parseFile(path: string, raw: string): Block {
  const { fm, body } = split(path, raw);
  const id = path.split("/").pop()!.replace(/\.md$/, "");
  const sections = sectionsOf(body);
  const tier = Number(fm.tier);
  return {
    id,
    name: String(fm.name),
    shape: fm.shape as Block["shape"],
    tier: tier === 1 || tier === 2 || tier === 3 ? tier : null,
    status: (fm.status as Status) ?? "planned",
    runsOn: (fm.runsOn as RunsOn[]) ?? [],
    gas: (fm.gas as Block["gas"]) ?? null,
    inputs: ((fm.inputs as { name: unknown; what: unknown }[]) ?? []).map((x) => ({ name: String(x.name), what: String(x.what ?? "") })),
    perTrigger: String(fm.perTrigger ?? ""),
    output: String(fm.output ?? ""),
    useCases: {
      ready: strings((fm.useCases as Record<string, unknown> | undefined)?.ready),
      configs: strings((fm.useCases as Record<string, unknown> | undefined)?.configs),
      ideas: strings((fm.useCases as Record<string, unknown> | undefined)?.ideas),
    },
    builtFrom: strings(fm.builtFrom),
    postQuantum: Boolean(fm.postQuantum),
    sdk: typeof fm.sdk === "string" ? fm.sdk : null,
    related: strings(fm.related),
    code: strings(fm.code),
    sections,
    summary: sections["Overview"] ?? "",
  };
}

const ALL: Block[] = Object.entries(files).map(([p, raw]) => parseFile(p, raw));
const shapeOrder = (b: Block) => (b.shape === "ready-made" ? 99 : SHAPES.findIndex((s) => s.id === b.shape));

/** Every block (checks, joins, actions, payers), by tier, then shape, then name. */
export const BLOCKS: Block[] = ALL.filter((b) => b.shape !== "ready-made" && b.shape !== "signer").sort(
  (a, b) => (a.tier ?? 9) - (b.tier ?? 9) || shapeOrder(a) - shapeOrder(b) || a.name.localeCompare(b.name),
);
/** Signers: the Signature condition's key types, by measured validation gas. */
export const SIGNERS: Block[] = ALL.filter((b) => b.shape === "signer").sort((a, b) => (a.gas?.validation ?? 9e9) - (b.gas?.validation ?? 9e9));
/** Complete contracts: whole applications made of blocks. */
export const READY_MADE: Block[] = ALL.filter((b) => b.shape === "ready-made").sort((a, b) => a.name.localeCompare(b.name));
/** Blocks and complete contracts together. */
export const CATALOG: Block[] = [...BLOCKS, ...SIGNERS, ...READY_MADE];
export const MODULES = CATALOG;

export const blockById = (id: string) => CATALOG.find((m) => m.id === id);
export const moduleById = blockById;

/** "Check", "Join", ..., or "Ready-made build". */
export const shapeLabel = (b: Block) => (b.shape === "ready-made" ? "Complete contract" : (shapeById(b.shape)?.name ?? b.shape));

// ---------------------------------------------------------------- example projects

export type GroupId = "protect" | "private" | "gas" | "sign";

/** The example folders under examples/, used only to label and group the examples. */
export const GROUPS: { id: GroupId; name: string }[] = [
  { id: "protect", name: "Protect a position or protocol" },
  { id: "private", name: "Move money privately" },
  { id: "gas", name: "Pay for gas" },
  { id: "sign", name: "Sign and recover" },
];

export interface Project {
  /** "<group>/<id>", the run's key too. */
  key: string;
  id: string;
  group: GroupId;
  name: string;
  problem: string;
  /** Block ids (and complete contract ids) with the role each plays here. */
  modules: { id: string; role: string }[];
  /** What the build protects or acts on, when it is a demo contract and not a block. */
  target: string | null;
  /** The Solidity file of the build. */
  build: string | null;
  featured: string;
  flagship: boolean;
  order: number;
  summary: string;
  /** Built when every block it names is built. */
  status: Status;
}

export const PROJECTS: Project[] = Object.entries(projectFiles)
  .map(([p, raw]) => {
    const { fm, body } = split(p, raw);
    const [group, id] = p.split("/").slice(-3, -1) as [GroupId, string];
    const modules = ((fm.modules as { id: string; role: string }[]) ?? []).map((m) => ({ id: String(m.id), role: String(m.role ?? "") }));
    const project: Project = {
      key: `${group}/${id}`,
      id,
      group,
      name: String(fm.name),
      problem: String(fm.problem ?? ""),
      modules,
      target: typeof fm.target === "string" ? fm.target : null,
      build: typeof fm.build === "string" ? fm.build : null,
      featured: String(fm.featured ?? ""),
      flagship: Boolean(fm.flagship),
      order: Number(fm.order ?? 99),
      summary: body.trim(),
      status: modules.every((m) => blockById(m.id)?.status === "built") ? "built" : "planned",
    };
    return project;
  })
  .sort((a, b) => a.order - b.order);

export const projectByKey = (key: string) => PROJECTS.find((p) => p.key === key);
export const projectsUsing = (blockId: string) => PROJECTS.filter((p) => p.modules.some((m) => m.id === blockId));

export const REPO = "https://github.com/ayush18pop/Popcorn";
export const NPM_PACKAGE = "@popcorn-eth/sdk";
export const NPM_URL = "https://www.npmjs.com/package/@popcorn-eth/sdk";
export const repoFile = (path: string) => `${REPO}/blob/main/${path}`;

/** Block ids before the developer renaming, so old links still open the right page. */
export const OLD_BLOCK_IDS: Record<string, string> = {
  "all-of": "and",
  "any-of": "or",
  "none-of": "not",
  "at-least-k-of-n": "k-of-n",
  "exactly-one-of": "exactly-one",
  "value-crosses-a-line": "compare",
  "value-moves-too-fast": "percent-change",
  "contract-code-changed": "code-hash-changed",
  "signed-instruction": "signature",
  "statement-signed-by-reporters": "k-of-n-attestation",
  "proof-that-the-rules-were-broken": "exploit-proof",
  "prove-youre-in-the-group": "membership-proof",
  "make-a-call": "call",
  "pause-the-target": "pause",
  "pay-the-reward": "reward-pool",
  "anonymous-group-vote": "anonymous-vote",
  "hand-over-to-a-new-key": "key-rotation",
  "exit-to-an-address": "withdraw-all",
  "switch-to-quantum-safe-only": "post-quantum-mode",
  "repay-a-loan": "repay",
  "contract-pays-the-gas": "self-paying",
  "payer-gets-rewarded": "caller-pays",
  "public-gas-sponsor": "paymaster",
  "private-pool": "privacy-pool",
  "stealth-vault": "stealth-addresses"
};
