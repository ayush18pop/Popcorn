// The module catalog and the example projects. docs/catalog/<group>/<module>.md and examples/<group>/<id>/project.md are
// the single sources: front matter for the facts the site filters and badges on, Markdown sections for the page.
import { parse as parseYaml } from "yaml";

const files = import.meta.glob("../../../../docs/catalog/*/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const projectFiles = import.meta.glob("../../../../examples/*/*/project.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export type GroupId = "private" | "gas" | "protect" | "sign" | "prove";
/** Kept for the pages that still say corner. */
export type CornerId = GroupId;
export type Trigger = "invariant" | "market" | "dependency" | "people" | "proof" | "tickets" | "payment" | "tooling";
export type Status = "built" | "planned" | "research";
export type RunsOn = "public" | "alternative" | "alternative-staked";

export interface Group {
  id: GroupId;
  name: string;
  does: string;
  triggers: Trigger[];
}

/** The five use-case groups (decisions 68 and 72). */
export const GROUPS: Group[] = [
  { id: "private", name: "Move money privately", does: "Receive, hold and send without linking your addresses", triggers: ["proof"] },
  { id: "gas", name: "Pay for gas", does: "Who pays, without a server or a relayer in the way", triggers: ["payment"] },
  { id: "protect", name: "Protect a position or protocol", does: "Pause, repay or exit before losses, with no keeper", triggers: ["invariant", "market", "dependency", "people", "tickets"] },
  { id: "sign", name: "Sign and recover", does: "Who may act: keys, post-quantum signatures, guardians", triggers: ["people", "proof"] },
  { id: "prove", name: "Prove and publish", does: "Evidence a contract can check: proofs, attestations, membership", triggers: ["proof", "people"] },
];
export const CORNERS = GROUPS;

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

export const RUNS_ON_TEXT: Record<RunsOn, string> = {
  public: "Public mempool",
  alternative: "Alternative mempool",
  "alternative-staked": "Alternative mempool, staked",
};

export interface Module {
  id: string;
  name: string;
  group: GroupId;
  /** Same as group (older pages). */
  corner: GroupId;
  trigger: Trigger;
  status: Status;
  runsOn: RunsOn[];
  usedIn: string[];
  properties: string[];
  gas: { validation?: number; total?: number; tag: "measured" | "estimated"; network: string } | null;
  example: string | null; // e.g. "private/private-payroll"
  related: string[];
  code: string[];
  postQuantum: boolean;
  schemes: string[];
  /** Markdown sections by heading ("What it does", "When it fires", ...). */
  sections: Record<string, string>;
  summary: string;
}

function split(path: string, raw: string) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`file without front matter: ${path}`);
  return { fm: parseYaml(m[1]!) as Record<string, unknown>, body: m[2]! };
}

function sectionsOf(body: string) {
  const sections: Record<string, string> = {};
  let cur = "";
  for (const line of body.split("\n")) {
    const h = /^## (.+)$/.exec(line);
    if (h) {
      cur = h[1]!;
      sections[cur] = "";
    } else if (cur) sections[cur] += line + "\n";
  }
  for (const k of Object.keys(sections)) sections[k] = sections[k]!.trim();
  return sections;
}

function parseFile(path: string, raw: string): Module {
  const { fm, body } = split(path, raw);
  const id = path.split("/").pop()!.replace(/\.md$/, "");
  const sections = sectionsOf(body);
  const example = typeof fm.example === "string" ? fm.example.replace(/^examples\//, "").replace(/\/run\.json$/, "") : null;
  const group = fm.group as GroupId;
  return {
    id,
    name: String(fm.name),
    group,
    corner: group,
    trigger: fm.trigger as Trigger,
    status: fm.status as Status,
    runsOn: (fm.runsOn as RunsOn[]) ?? [],
    usedIn: (fm.usedIn as string[]) ?? [],
    properties: (fm.properties as string[]) ?? [],
    gas: (fm.gas as Module["gas"]) ?? null,
    example,
    related: (fm.related as string[]) ?? [],
    code: (fm.code as string[]) ?? [],
    postQuantum: Boolean(fm.postQuantum),
    schemes: (fm.schemes as string[]) ?? [],
    sections,
    summary: sections["What it does"] ?? "",
  };
}

export const MODULES: Module[] = Object.entries(files)
  .map(([p, raw]) => parseFile(p, raw))
  .sort((a, b) => GROUPS.findIndex((c) => c.id === a.group) - GROUPS.findIndex((c) => c.id === b.group) || (a.status === b.status ? 0 : a.status === "built" ? -1 : 1) || a.name.localeCompare(b.name));

export const moduleById = (id: string) => MODULES.find((m) => m.id === id);
export const groupById = (id: string) => GROUPS.find((c) => c.id === id);
export const cornerById = groupById;

// ---------------------------------------------------------------- example projects (decision 70)

export interface Project {
  /** "<group>/<id>", the run's key too. */
  key: string;
  id: string;
  group: GroupId;
  name: string;
  problem: string;
  modules: { id: string; role: string }[];
  featured: string;
  flagship: boolean;
  summary: string;
  /** Built when every module it names is built. */
  status: Status;
}

export const PROJECTS: Project[] = Object.entries(projectFiles)
  .map(([p, raw]) => {
    const { fm, body } = split(p, raw);
    const [group, id] = p.split("/").slice(-3, -1) as [GroupId, string];
    const modules = (fm.modules as { id: string; role: string }[]) ?? [];
    const project: Project = {
      key: `${group}/${id}`,
      id,
      group,
      name: String(fm.name),
      problem: String(fm.problem ?? ""),
      modules,
      featured: String(fm.featured ?? ""),
      flagship: Boolean(fm.flagship),
      summary: body.trim(),
      status: modules.every((m) => moduleById(m.id)?.status === "built") ? "built" : "planned",
    };
    return project;
  })
  .sort((a, b) => Number(a.flagship) - Number(b.flagship) || GROUPS.findIndex((g) => g.id === a.group) - GROUPS.findIndex((g) => g.id === b.group));

export const projectByKey = (key: string) => PROJECTS.find((p) => p.key === key);
export const projectsUsing = (moduleId: string) => PROJECTS.filter((p) => p.modules.some((m) => m.id === moduleId));

export const REPO = "https://github.com/ayush18pop/Popcorn";
export const repoFile = (path: string) => `${REPO}/blob/main/${path}`;
