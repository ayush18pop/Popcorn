// Popcorn's MCP server: read-only. It reads the catalog, the example projects and their recorded runs, explains refusal
// codes, and talks to a devnet only to simulate or to build an unsigned transaction. It holds no key and sends nothing:
// a rule-pays trigger it builds is complete without a signature, and anyone (the user's own wallet or script) sends it.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { getAddress, type Address, type Hex } from "viem";
import { CORE_ERRORS, OPEN_SPONSOR_ERRORS, createPopcornContext, popcornActions, prepareTrigger, readRuleContract } from "@popcorn/sdk";

export const ROOT = new URL("../../../", import.meta.url).pathname;
const GROUPS: Record<string, string> = {
  private: "Move money privately",
  gas: "Pay for gas",
  protect: "Protect a position or protocol",
  sign: "Sign and recover",
  prove: "Prove and publish",
};

interface Doc {
  id: string;
  group: string;
  fm: Record<string, unknown>;
  body: string;
}

function readDocs(dir: string, file?: string): Doc[] {
  const out: Doc[] = [];
  if (!existsSync(dir)) return out;
  for (const group of readdirSync(dir)) {
    const gdir = join(dir, group);
    for (const entry of readdirSync(gdir)) {
      const path = file ? join(gdir, entry, file) : join(gdir, entry);
      if (!path.endsWith(".md") || !existsSync(path)) continue;
      const raw = readFileSync(path, "utf8");
      const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
      if (!m) continue;
      out.push({ id: file ? entry : entry.replace(/\.md$/, ""), group, fm: parseYaml(m[1]!) as Record<string, unknown>, body: m[2]!.trim() });
    }
  }
  return out;
}

const modules = () => readDocs(join(ROOT, "docs/catalog"));
const projects = () => readDocs(join(ROOT, "examples"), "project.md");
const runOf = (group: string, id: string) => {
  const p = join(ROOT, "examples", group, id, "run.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>) : null;
};
const section = (body: string, name: string) => new RegExp(`## ${name}\\n\\n([\\s\\S]*?)(\\n## |$)`).exec(body)?.[1]?.trim() ?? "";
const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2) }] });
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const network = z.enum(["local", "devnet1"]).default("local").describe("local = the local devnet (chain 1338), devnet1 = the public devnet (chain 1337)");
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const trig = {
  network,
  ruleContract: z.string().describe("the rule contract (the transaction's sender)"),
  triggerData: hex.optional().describe("abi-encoded trigger data (popArgs)"),
  verifyData: hex.optional().describe("the VERIFY frame's data: a proof or a signature"),
  payer: z.string().optional().describe("caller-pays only: the payer contract or EOA address"),
  payerData: hex.optional().describe("caller-pays only: data for a payer contract's frame (e.g. an Open Sponsor membership proof)"),
  tail: z.object({ target: z.string(), data: hex, gasLimit: z.string(), stateGasLimit: z.string().optional() }).optional().describe("caller-pays only: the DEFAULT frame after the action (an Open Sponsor's accounting frame)"),
};
type TrigArgs = { network: "local" | "devnet1"; ruleContract: string; triggerData?: string; verifyData?: string; payer?: string; payerData?: string; tail?: { target: string; data: string; gasLimit: string; stateGasLimit?: string } };
const options = (a: TrigArgs) => ({
  ...(a.triggerData ? { triggerData: a.triggerData as Hex } : {}),
  ...(a.verifyData ? { verifyData: a.verifyData as Hex } : {}),
  ...(a.payer ? { payer: getAddress(a.payer) } : {}),
  ...(a.payerData ? { payerData: a.payerData as Hex } : {}),
  ...(a.tail ? { tail: { target: getAddress(a.tail.target), data: a.tail.data as Hex, gasLimit: BigInt(a.tail.gasLimit), ...(a.tail.stateGasLimit ? { stateGasLimit: BigInt(a.tail.stateGasLimit) } : {}) } } : {}),
});
const ctxFor = (n: "local" | "devnet1") => createPopcornContext({ devnet: n });

export function createServer(): McpServer {
  const server = new McpServer({ name: "popcorn", version: "0.1.0" });

  server.registerTool(
    "list_modules",
    { description: "List Popcorn modules (one job each), optionally for one use-case group: private, gas, protect, sign, prove.", inputSchema: { group: z.enum(["private", "gas", "protect", "sign", "prove"]).optional() } },
    async ({ group }) =>
      json(
        modules()
          .filter((m) => !group || m.group === group)
          .map((m) => ({ id: m.id, name: m.fm.name, group: GROUPS[m.group], status: m.fm.status, runsOn: m.fm.runsOn, postQuantum: Boolean(m.fm.postQuantum), whatItDoes: section(m.body, "What it does") })),
      ),
  );

  server.registerTool(
    "get_module",
    { description: "One module's full page: what it does, when it fires, what it does then, where it runs, code, limits and source files.", inputSchema: { id: z.string() } },
    async ({ id }) => {
      const m = modules().find((x) => x.id === id);
      return m ? json({ id: m.id, group: GROUPS[m.group], ...m.fm, page: m.body }) : text(`no module "${id}"; call list_modules`);
    },
  );

  server.registerTool(
    "list_examples",
    { description: "List the example projects: the problem each solves, the modules it is built from with their roles, and whether it was recorded on a devnet.", inputSchema: {} },
    async () =>
      json(
        projects().map((p) => {
          const run = runOf(p.group, p.id);
          return { id: p.id, group: GROUPS[p.group], name: p.fm.name, flagship: Boolean(p.fm.flagship), problem: p.fm.problem, modules: p.fm.modules, recorded: Boolean(run?.recorded), transactions: Array.isArray(run?.story) ? run.story.length : 0 };
        }),
      ),
  );

  server.registerTool(
    "get_example",
    { description: "One example project: its modules and roles, every recorded transaction (module, role, hash, block, gas), the featured transaction's five stages and its refused case, and the command that re-records it.", inputSchema: { id: z.string() } },
    async ({ id }) => {
      const p = projects().find((x) => x.id === id);
      if (!p) return text(`no example "${id}"; call list_examples`);
      const run = runOf(p.group, p.id);
      return json({ ...p.fm, summary: p.body, run, rerecord: `bun packages/sdk/scripts/record-examples.ts ${p.id}` });
    },
  );

  server.registerTool(
    "explain_code",
    { description: "Explain a refusal code: a Popcorn Core code (frame 0, the rule contract) or an Open Sponsor code (frame 1, the payer).", inputSchema: { code: z.union([z.number(), z.string()]), frame: z.enum(["rule", "payer"]).default("rule") } },
    async ({ code, frame }) => {
      const n = typeof code === "number" ? code : Number(code.startsWith("0x") ? BigInt(code) : BigInt(code));
      if (frame === "payer") return json({ code: `0x${n.toString(16)}`, frame: "payer (Open Sponsor)", reason: OPEN_SPONSOR_ERRORS[n] ?? "not an Open Sponsor code" });
      const e = CORE_ERRORS[n];
      return json(e ? { code: `0x${n.toString(16)}`, frame: "rule contract (Core)", ...e, costs: e.section === "VERIFY" ? "nothing: the transaction is invalid and nobody pays" : "the action reverted after payment was approved" } : { code: `0x${n.toString(16)}`, reason: "not a Core code" });
    },
  );

  server.registerTool(
    "rule_contract_info",
    { description: "Read a deployed rule contract: its logic, payment mode, caps, balance and minimum operating balance. Read-only.", inputSchema: { network, ruleContract: z.string() } },
    async ({ network: n, ruleContract }) => json(await readRuleContract(ctxFor(n), getAddress(ruleContract))),
  );

  server.registerTool(
    "can_trigger",
    { description: "Simulate a trigger on the devnet's node and say whether it would be accepted now, and if not, which frame refused it and why. Sends nothing.", inputSchema: trig },
    async (a) => {
      const r = await popcornActions.simulate(ctxFor(a.network), getAddress(a.ruleContract), options(a as TrigArgs) as never);
      return json(r);
    },
  );

  server.registerTool(
    "build_trigger",
    {
      description:
        "Build the exact frame transaction for a trigger and return it unsigned, with its frames explained. A rule-pays trigger needs no signature: whoever the user chooses can broadcast it with eth_sendRawTransaction. A caller-pays trigger with an EOA payer still needs the payer's signature. This server never signs or sends.",
      inputSchema: trig,
    },
    async (a) => {
      const p = await prepareTrigger(ctxFor(a.network), getAddress(a.ruleContract), options(a as TrigArgs) as never, false);
      const MODE = ["DEFAULT", "VERIFY", "SENDER"];
      return json({
        ready: p.readiness.ready,
        readiness: p.readiness,
        raw: p.raw,
        hash: p.hash,
        needsSignature: p.payer !== null && p.tx.signatures.length > 0,
        maxCost: p.maxCost,
        nonceKey: p.nonceKey,
        frames: p.tx.frames.map((f, i) => ({ index: i, mode: MODE[f.mode], flags: f.flags, target: f.target ?? "the rule contract (sender)", gasLimit: f.gasLimit, dataBytes: (f.data.length - 2) / 2 })),
        send: "eth_sendRawTransaction(raw) to the devnet's alternative mempool (ERC-8421 sidecar) or node",
      });
    },
  );

  server.registerTool(
    "how_to_build",
    { description: "The steps and SDK calls to build a project like one of the examples yourself, module by module.", inputSchema: { id: z.string().describe("an example id from list_examples") } },
    async ({ id }) => {
      const p = projects().find((x) => x.id === id);
      if (!p) return text(`no example "${id}"; call list_examples`);
      const mods = (p.fm.modules as { id: string; role: string }[]).map((r) => {
        const m = modules().find((x) => x.id === r.id);
        return { module: r.id, role: r.role, code: m ? section(m.body, "Code") : "", sources: m?.fm.code };
      });
      return json({ example: p.fm.name, problem: p.fm.problem, steps: mods, fullScript: "packages/sdk/scripts/record-examples.ts", run: `bun packages/sdk/scripts/record-examples.ts ${id}` });
    },
  );

  return server;
}

export type { Address };
