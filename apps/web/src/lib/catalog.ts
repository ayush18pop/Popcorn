// The block catalog and the example projects. docs/catalog/<checks|joins|actions|payers|ready-made>/<id>.md and
// examples/<group>/<id>/project.md are the single sources: front matter for the facts the site filters and badges on,
// Markdown sections for the page.
import { parse as parseYaml } from "yaml";

const files = import.meta.glob("../../../../docs/catalog/*/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const projectFiles = import.meta.glob("../../../../examples/*/*/project.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export type Status = "built" | "planned" | "research";
export type RunsOn = "public" | "alternative" | "alternative-staked";
export type ShapeId = "check" | "join" | "action" | "payer";
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
  { id: "check", name: "Check", plural: "Checks", does: "Answers yes, no or unknown. Unknown never fires." },
  { id: "join", name: "Join", plural: "Joins", does: "Combines checks into one answer: all of, any of, none of, at least k of n, exactly one of, if / else." },
  { id: "action", name: "Action", plural: "Actions", does: "Does one thing when the checks say yes." },
  { id: "payer", name: "Payer", plural: "Payers", does: "Pays the gas." },
];
export const shapeById = (id: string) => SHAPES.find((s) => s.id === id);

export const TIERS: { id: TierId; title: string }[] = [
  { id: 1, title: "Without these, nothing works" },
  { id: 2, title: "With these, the headline examples work" },
  { id: 3, title: "With these, the rest of the listed use cases work" },
];

export interface Block {
  id: string;
  name: string;
  /** "ready-made" for whole builds (Private Pool, Stealth Vault). */
  shape: ShapeId | "ready-made";
  /** Absent for ready-made builds. */
  tier: TierId | null;
  status: Status;
  runsOn: RunsOn[];
  gas: { validation?: number; total?: number; tag: "measured" | "estimated"; network: string } | null;
  inputs: { name: string; what: string }[];
  perTrigger: string;
  output: string;
  presets: string[];
  builtFrom: string[];
  sdk: string | null;
  related: string[];
  code: string[];
  /** Markdown sections by heading ("What it does", "Inputs", "Code", ...). */
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
    presets: strings(fm.presets),
    builtFrom: strings(fm.builtFrom),
    sdk: typeof fm.sdk === "string" ? fm.sdk : null,
    related: strings(fm.related),
    code: strings(fm.code),
    sections,
    summary: sections["What it does"] ?? "",
  };
}

const ALL: Block[] = Object.entries(files).map(([p, raw]) => parseFile(p, raw));
const shapeOrder = (b: Block) => (b.shape === "ready-made" ? 99 : SHAPES.findIndex((s) => s.id === b.shape));

/** Every block (checks, joins, actions, payers), by tier, then shape, then name. */
export const BLOCKS: Block[] = ALL.filter((b) => b.shape !== "ready-made").sort(
  (a, b) => (a.tier ?? 9) - (b.tier ?? 9) || shapeOrder(a) - shapeOrder(b) || a.name.localeCompare(b.name),
);
/** Ready-made builds: whole applications made of blocks. */
export const READY_MADE: Block[] = ALL.filter((b) => b.shape === "ready-made").sort((a, b) => a.name.localeCompare(b.name));
/** Blocks and ready-made builds together. */
export const CATALOG: Block[] = [...BLOCKS, ...READY_MADE];
export const MODULES = CATALOG;

export const blockById = (id: string) => CATALOG.find((m) => m.id === id);
export const moduleById = blockById;

/** "Check", "Join", ..., or "Ready-made build". */
export const shapeLabel = (b: Block) => (b.shape === "ready-made" ? "Ready-made build" : (shapeById(b.shape)?.name ?? b.shape));

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
  /** Block ids (and ready-made build ids) with the role each plays here. */
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
export const repoFile = (path: string) => `${REPO}/blob/main/${path}`;
