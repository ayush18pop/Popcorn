import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { KeyRound, Lock, Play, ShieldCheck } from "lucide-react";
import { Snippet, SnippetCopyButton, SnippetHeader, SnippetTabsContent, SnippetTabsList, SnippetTabsTrigger } from "@/components/kibo-ui/snippet";
import { Reveal, Spotlight } from "@/components/motion";
import { StatusBadge, TAB } from "@/components/bits";
import { MODULES, PROJECTS } from "@/lib/catalog";
import { RUNS } from "@/lib/runs";
import { cn } from "@/lib/utils";

// The MCP server (packages/mcp) is read-only: it never holds a key and never sends. In the browser, this inspector runs
// the catalog and example tools against the files this site ships; the devnet tools run in the server.

const TOOLS: { name: string; does: string; input: string; local?: (arg: string) => unknown }[] = [
  {
    name: "list_modules", does: "The modules, optionally for one use-case group.", input: `{ "group": "private" }`,
    local: (a) => {
      const f = safe(a) as { group?: string };
      return MODULES.filter((m) => !f.group || m.group === f.group).map((m) => ({ id: m.id, name: m.name, group: m.group, status: m.status, runsOn: m.runsOn, postQuantum: m.postQuantum }));
    },
  },
  {
    name: "get_module", does: "One module's page: what it does, when it fires, where it runs, code, limits.", input: `{ "id": "open-sponsor" }`,
    local: (a) => {
      const m = MODULES.find((x) => x.id === (safe(a) as { id?: string }).id);
      return m ? { id: m.id, name: m.name, status: m.status, runsOn: m.runsOn, whatItDoes: m.summary, whenItFires: m.sections["When it fires"], limits: m.sections["Limits"], code: m.code } : { error: "no such module" };
    },
  },
  {
    name: "list_examples", does: "The example projects, their modules and roles, recorded or not.", input: `{}`,
    local: () => PROJECTS.map((p) => ({ id: p.id, name: p.name, problem: p.problem, modules: p.modules.map((m) => m.id), recorded: Boolean(RUNS[p.key]?.recorded) })),
  },
  {
    name: "get_example", does: "One project: every recorded transaction, the featured one's five stages and its refusal.", input: `{ "id": "private-payroll" }`,
    local: (a) => {
      const p = PROJECTS.find((x) => x.id === (safe(a) as { id?: string }).id);
      return p ? { name: p.name, modules: p.modules, story: RUNS[p.key]?.story, refused: RUNS[p.key]?.failing.result } : { error: "no such example" };
    },
  },
  { name: "how_to_build", does: "The modules, roles and SDK calls to build a project like an example.", input: `{ "id": "sovereign-account" }` },
  { name: "explain_code", does: "A Core code (frame 0) or an Open Sponsor code (frame 1) in plain words, and who paid.", input: `{ "code": "0x6c", "frame": "payer" }` },
  { name: "rule_contract_info", does: "A deployed rule contract's logic, mode, caps and balance.", input: `{ "network": "local", "ruleContract": "0x…" }` },
  { name: "can_trigger", does: "Simulates a trigger on the devnet: would it be accepted now, and if not which frame refused it.", input: `{ "network": "local", "ruleContract": "0x…", "triggerData": "0x…", "verifyData": "0x…" }` },
  { name: "build_trigger", does: "The exact frame transaction, unsigned, with its frames explained. A rule-pays trigger needs no signature: you send it.", input: `{ "network": "local", "ruleContract": "0x…" }` },
];

function safe(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

const INSTALL = [
  { id: "claude", label: "Claude Code", cmd: "claude mcp add popcorn -- bun /path/to/Popcorn/packages/mcp/src/index.ts   # or open the repo: .mcp.json adds it" },
  { id: "json", label: "other clients", cmd: `{ "mcpServers": { "popcorn": { "command": "bun", "args": ["/path/to/Popcorn/packages/mcp/src/index.ts"] } } }` },
];

export default function Mcp() {
  const [tool, setTool] = useState(TOOLS[0].name);
  const t = TOOLS.find((x) => x.name === tool)!;
  const [input, setInput] = useState(t.input);
  const [out, setOut] = useState<string | null>(null);
  const [tab, setTab] = useState(INSTALL[0].id);
  const pick = (name: string) => {
    const n = TOOLS.find((x) => x.name === name)!;
    setTool(name);
    setInput(n.input);
    setOut(null);
  };
  const run = () => setOut(t.local ? JSON.stringify(t.local(input), null, 2) : "This tool talks to a devnet, so it runs in the MCP server (packages/mcp), not in the browser. It simulates or builds; it never signs or sends.");
  const lines = useMemo(() => (out ?? "").split("\n"), [out]);

  return (
    <div className="relative overflow-x-clip">
      <div className="hatch pointer-events-none absolute inset-x-0 top-0 h-[700px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="relative mx-auto max-w-[1120px] px-4 pb-32 pt-36 sm:px-6">
        <Reveal>
          <div className="flex items-center gap-3">
            <p className="label-mono">MCP server</p>
            <StatusBadge status="built" />
          </div>
          <h1 className="text-chrome mt-4 max-w-[860px] text-[42px] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[64px]">Tools that read. Never a key.</h1>
          <p className="mt-5 max-w-[600px] text-[16px] leading-relaxed text-muted-foreground">
            An MCP server for Claude and other clients: browse the catalog, plan and check rules, explain why a trigger was refused. Read-only by default.
          </p>
        </Reveal>

        {/* safety model */}
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {[
            { icon: Lock, t: "Read-only by default", d: "Every tool reads. Nothing is sent to a mempool unless you sign and send it yourself." },
            { icon: KeyRound, t: "Never holds a key", d: "It never asks for or stores a private key. build_trigger_tx returns an unsigned transaction." },
            { icon: ShieldCheck, t: "Same checks as the SDK", d: "Verdicts come from the simulator's rule table, the same one simulate() uses." },
          ].map((x, i) => (
            <Reveal key={x.t} delay={i * 0.08}>
              <Spotlight className="glass h-full rounded-[24px] p-6">
                <x.icon className="size-5 text-muted-foreground" />
                <h3 className="mt-5 text-[16px] font-semibold tracking-tight">{x.t}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{x.d}</p>
              </Spotlight>
            </Reveal>
          ))}
        </div>

        {/* inspector */}
        <section className="mt-20">
          <Reveal>
            <p className="label-mono mb-3">Tool inspector</p>
            <h2 className="text-chrome text-[30px] font-semibold tracking-[-0.03em]">Try the tools.</h2>
            <p className="mt-2 max-w-[600px] text-[14px] text-muted-foreground">
              <code className="font-mono">list_modules</code> and <code className="font-mono">get_module</code> run here, on the catalog this site ships. The others need the server.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="mt-8">
            <div className="glass-strong border-spin overflow-hidden rounded-[22px] p-1.5">
              <div className="grid overflow-hidden rounded-[17px] border border-[var(--glass-border)] bg-background/70 md:grid-cols-[230px_1fr]">
                <div className="border-b border-[var(--glass-border)] p-2 md:border-b-0 md:border-r">
                  {TOOLS.map((x) => (
                    <button key={x.name} onClick={() => pick(x.name)} className={cn("relative flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-mono text-[12px]", tool === x.name ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                      {tool === x.name && <motion.span layoutId="tool-sel" className="absolute inset-0 rounded-lg bg-foreground/[0.07]" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                      <span className="relative">{x.name}</span>
                      {x.local && <span className="relative size-1.5 rounded-full bg-foreground" title="runs in the browser" />}
                    </button>
                  ))}
                </div>
                <div className="flex min-w-0 flex-col">
                  <div className="border-b border-[var(--glass-border)] p-4">
                    <p className="text-[13px] text-foreground/85">{t.does}</p>
                    <p className="label-mono mt-4">Input</p>
                    <textarea value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} rows={2} className="mt-2 w-full resize-none rounded-xl border border-[var(--glass-border)] bg-foreground/[0.03] p-3 font-mono text-[12px] outline-none focus:border-foreground/30" />
                    <button onClick={run} className="btn-solid mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-foreground px-4 text-[12px] font-medium text-background">
                      <Play className="size-3.5" /> Call {t.name}
                    </button>
                  </div>
                  <div className="min-h-[220px] flex-1 p-4">
                    <p className="label-mono">Result</p>
                    <AnimatePresence mode="wait">
                      {out ? (
                        <motion.pre key={out} className="mt-2 max-h-[360px] overflow-auto font-mono text-[11.5px] leading-relaxed text-muted-foreground">
                          {lines.map((l, i) => (
                            <motion.span key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 40) * 0.012 }} className="block">
                              {l}
                            </motion.span>
                          ))}
                        </motion.pre>
                      ) : (
                        <p className="mt-2 font-mono text-[12px] text-faint">Call the tool to see its result.</p>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* install */}
        <section className="mt-20">
          <Reveal>
            <p className="label-mono mb-3">Install · when it ships</p>
            <Snippet value={tab} onValueChange={setTab} className="glass rounded-2xl border-[var(--glass-border)]">
              <SnippetHeader className="border-[var(--glass-border)] bg-transparent px-2">
                <SnippetTabsList className="rounded-full bg-transparent">
                  {INSTALL.map((x) => (
                    <SnippetTabsTrigger key={x.id} value={x.id} className={TAB}>
                      {x.label}
                    </SnippetTabsTrigger>
                  ))}
                </SnippetTabsList>
                <SnippetCopyButton value={INSTALL.find((x) => x.id === tab)!.cmd} className="opacity-100" />
              </SnippetHeader>
              {INSTALL.map((x) => (
                <SnippetTabsContent key={x.id} value={x.id} className="overflow-x-auto bg-transparent px-4 py-3.5 font-mono text-[12.5px] text-muted-foreground">
                  {x.cmd}
                </SnippetTabsContent>
              ))}
            </Snippet>
            <p className="mt-3 text-[12px] text-faint">The package name is a placeholder until the server exists.</p>
          </Reveal>
        </section>
      </div>
    </div>
  );
}
