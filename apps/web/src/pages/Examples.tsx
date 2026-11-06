import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Check, Copy } from "lucide-react";
import { MetalNumeral } from "@/components/MetalNumeral";
import { Reveal } from "@/components/motion";
import { PrimaryLink, StatusBadge } from "@/components/bits";
import { Player } from "@/player/Player";
import { FlowGraph, FlowVerdict } from "@/components/FlowGraph";
import type { Run } from "@/lib/runs";
import { GROUPS, PROJECTS, blockById, projectByKey, repoFile, shapeLabel, type Project } from "@/lib/catalog";
import { RUNS, fmt, step } from "@/lib/runs";
import { href } from "@/lib/route";
import { cn } from "@/lib/utils";

// Examples are whole projects (builds) assembled from several blocks, each with a role (decision 70). Each one plays a run
// recorded on the local devnet by packages/sdk/scripts/record-examples.ts, and lists every transaction it made.

export default function Examples({ runKey }: { runKey?: string }) {
  const p = runKey ? projectByKey(runKey) : undefined;
  return p ? <ProjectPage p={p} /> : <Index />;
}

const groupName = (id: string) => GROUPS.find((g) => g.id === id)?.name ?? id;
const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className="glass inline-flex h-10 items-center gap-2 rounded-full px-4 text-[12.5px] text-muted-foreground hover:text-foreground"
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {label}
    </button>
  );
}

function BlockRoles({ p, dense = false }: { p: Project; dense?: boolean }) {
  return (
    <>
      <ol className={cn("space-y-2", dense && "space-y-1.5")}>
        {p.modules.map((r, i) => {
          const m = blockById(r.id);
          return (
            <li key={r.id + i} className="grid grid-cols-[22px_1fr] gap-3 text-[13px]">
              <span className="font-mono text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
              <span>
                {m ? (
                  <a href={href("blocks", m.id)} className="font-medium text-foreground underline-offset-4 hover:underline">
                    {m.name}
                  </a>
                ) : (
                  <span className="font-mono text-foreground">{r.id}</span>
                )}
                {m && <span className="ml-1.5 font-mono text-[10.5px] text-faint">{shapeLabel(m).toLowerCase()}</span>}
                {!dense && r.role && <span className="text-muted-foreground"> · {r.role}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {p.target && (
        <div className={cn("border-t border-[var(--glass-border)] text-[13px]", dense ? "mt-3 pt-3" : "mt-4 pt-4")}>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-faint">Target (demo, not a block)</p>
          <p className="mt-1 text-muted-foreground">{p.target.replace(/\s*\(demo, not a block\)\s*$/, "")}</p>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------- one project */

function ProjectPage({ p }: { p: Project }) {
  const run = RUNS[p.key];
  const include = run ? step(run.steps, "include") : undefined;
  const prompt = `Using the Popcorn skill and MCP server, build a "${p.name}" like examples/${p.key}: ${p.problem} Use these blocks: ${p.modules.map((m) => m.id).join(", ")}. Deploy it to my local devnet, run its story, and show me each transaction.`;
  return (
    <div className="relative overflow-x-clip px-4 pb-24 pt-32 sm:px-6">
      <div className="mx-auto max-w-[1320px]">
        <Reveal>
          <a href={href("examples")} className="label-mono hover:text-foreground">← Examples</a>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="label-mono">{p.flagship ? "Flagship" : groupName(p.group)}</span>
            <StatusBadge status={p.status} />
          </div>
          <h1 className="text-chrome mt-3 max-w-[900px] text-[36px] font-semibold leading-[1.04] tracking-[-0.04em] md:text-[56px]">{p.name}</h1>
          <p className="mt-4 max-w-[760px] text-[16px] leading-relaxed text-muted-foreground">{p.problem}</p>
          <p className="mt-3 max-w-[760px] text-[15px] leading-relaxed text-foreground/85">{p.summary}</p>
        </Reveal>

        {run ? (
          <Reveal delay={0.12} className="mt-10">
            <RunFlows run={run} featured={p.featured} />
            <details className="mt-6">
              <summary className="label-mono cursor-pointer hover:text-foreground">Raw frames of the featured transaction</summary>
              <div className="mt-4">
                <Player run={run} />
              </div>
            </details>
            {run.owner && <p className="mt-3 text-[12px] text-muted-foreground">{run.owner}</p>}
          </Reveal>
        ) : (
          <p className="mt-10 rounded-2xl border border-dashed border-foreground/20 px-4 py-3 text-[13px] text-muted-foreground">Not recorded yet.</p>
        )}

        <div className="mt-16 grid gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          {/* the story: every transaction the project made, in order */}
          <Reveal>
            <p className="label-mono mb-4">What happened, transaction by transaction</p>
            <ol className="relative space-y-3 border-l border-[var(--glass-border)] pl-6">
              {(run?.story ?? []).map((s, i) => {
                const m = blockById(s.module);
                return (
                  <motion.li key={s.tx + i} initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }} className="relative">
                    <span className="absolute -left-[31px] top-4 size-2.5 rounded-full border border-foreground/40 bg-background" />
                    <div className="glass rounded-2xl p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-faint">
                        <span>
                          {String(i + 1).padStart(2, "0")} · {m?.name ?? s.module} · {s.role}
                        </span>
                        <span>block {fmt(s.block)} · {fmt(s.gasUsed)} gas · {s.status}</span>
                      </div>
                      <p className="mt-2 text-[14px] leading-relaxed text-foreground/90">{s.title}</p>
                      <a href={href("explorer", run!.network.name === "local" ? "local" : "devnet1", s.tx)} className="mt-2 inline-block font-mono text-[11px] text-muted-foreground hover:text-foreground" title={s.tx}>{shortHash(s.tx)} · explorer →</a>
                    </div>
                  </motion.li>
                );
              })}
            </ol>
            {run && <p className="mt-4 text-[12px] text-faint">Recorded on the {run.network.name} devnet (chain {run.network.chainId}). Transaction hashes are the receipts the recorder read back.</p>}
          </Reveal>

          <div className="space-y-6">
            <Reveal delay={0.08}>
              <div className="glass rounded-[24px] p-6">
                <p className="label-mono mb-4">Blocks and their roles</p>
                <BlockRoles p={p} />
                {p.build && (
                  <a href={repoFile(p.build)} target="_blank" rel="noreferrer" className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--glass-border)] px-4 py-2.5 font-mono text-[12px] text-foreground/90 hover:border-foreground/30">
                    <span className="truncate">{p.build}</span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-faint" />
                  </a>
                )}
              </div>
            </Reveal>
            <Reveal delay={0.14}>
              <div className="glass rounded-[24px] p-6">
                <p className="label-mono mb-3">Build your own</p>
                <p className="text-[13px] leading-relaxed text-muted-foreground">Start from this project with Claude, the MCP server or the SDK. The SDK calls below are the ones the recorder ran.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <CopyButton text={prompt} label="Copy prompt" />
                  <a href={href("mcp")} className="glass inline-flex h-10 items-center gap-2 rounded-full px-4 text-[12.5px] text-muted-foreground hover:text-foreground">Install the MCP server <ArrowUpRight className="size-3.5" /></a>
                  <a href={href("skills")} className="glass inline-flex h-10 items-center gap-2 rounded-full px-4 text-[12.5px] text-muted-foreground hover:text-foreground">Claude skill <ArrowUpRight className="size-3.5" /></a>
                </div>
                <pre className="mt-4 overflow-x-auto rounded-2xl border border-[var(--glass-border)] p-4 font-mono text-[11.5px] leading-relaxed text-foreground/85">{`bun packages/sdk/scripts/record-examples.ts ${p.id}`}</pre>
                {include && <p className="mt-3 font-mono text-[11px] text-faint">featured tx {shortHash(include.tx)} · {fmt(include.gasUsed)} gas</p>}
              </div>
            </Reveal>
          </div>
        </div>

        <div className="mt-16">
          <p className="label-mono mb-4">Other examples</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PROJECTS.filter((o) => o.key !== p.key).map((o) => (
              <a key={o.key} href={href("examples", ...o.key.split("/"))} className="glass group rounded-2xl p-5 transition-transform hover:-translate-y-0.5">
                <p className="font-mono text-[11px] text-faint">{o.flagship ? "flagship" : groupName(o.group)}</p>
                <p className="mt-2 text-[14px] font-medium">{o.name}</p>
                <ArrowRight className="mt-4 size-4 text-faint transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- index */

function Index() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const els = PROJECTS.map((p) => document.getElementById(`ch-${p.key.replace("/", "-")}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && setActive(els.indexOf(e.target as HTMLElement))), { rootMargin: "-45% 0px -45% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="relative overflow-x-clip">
      <nav className="fixed left-8 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-4 xl:flex">
        {PROJECTS.map((p, i) => (
          <button key={p.key} onClick={() => document.getElementById(`ch-${p.key.replace("/", "-")}`)?.scrollIntoView({ behavior: "smooth" })} className="group flex items-center gap-3" aria-label={p.name}>
            <span className={cn("h-px transition-all duration-500", i === active ? "w-10 bg-foreground" : "w-5 bg-foreground/25 group-hover:w-8")} />
            <span className={cn("font-pixel text-[13px] transition-colors", i === active ? "text-foreground" : "text-faint")}>{String(i + 1).padStart(2, "0")}</span>
          </button>
        ))}
      </nav>

      <section className="px-4 pb-10 pt-40 sm:px-6">
        <div className="mx-auto max-w-[1120px]">
          <Reveal>
            <p className="label-mono mb-4">Examples</p>
            <h1 className="text-chrome max-w-[880px] text-[42px] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[72px]">
              Whole projects,
              <br />
              recorded on a devnet.
            </h1>
            <p className="mt-6 max-w-[620px] text-[17px] leading-relaxed text-muted-foreground">
              Each example solves one real problem with several blocks, each doing one job. Every transaction below happened on the local devnet, sent by a key with no ETH.
            </p>
          </Reveal>
        </div>
      </section>

      {PROJECTS.map((p, i) => {
        const run = RUNS[p.key];
        const include = run ? step(run.steps, "include") : undefined;
        const facts: [string, string][] = [
          ["Problem", p.problem],
          ["Transactions", run?.story ? `${run.story.length} on chain, every one from a key with no ETH or a funded user` : "not recorded yet"],
          ["Featured", include ? `${p.featured} · ${fmt(include.gasUsed)} gas` : p.featured],
          ["Refused case", run ? `${run.failing.result}${run.failing.core ? ` (${run.failing.core})` : ""}, costs nothing` : "—"],
        ];
        return (
          <section key={p.key} id={`ch-${p.key.replace("/", "-")}`} className="flex min-h-screen items-center px-4 py-24 sm:px-6">
            <div className={cn("mx-auto grid w-full max-w-[1120px] items-center gap-14", i % 2 === 1 ? "md:grid-cols-[1.08fr_0.92fr]" : "md:grid-cols-[0.92fr_1.08fr]")}>
              <div className={cn(i % 2 === 1 && "md:order-2")}>
                <Reveal>
                  <MetalNumeral text={String(i + 1).padStart(2, "0")} height={130} />
                </Reveal>
                <Reveal delay={0.08}>
                  <p className="label-mono mt-6">{p.flagship ? "Flagship" : groupName(p.group)}</p>
                  <h2 className="text-chrome mt-3 text-[36px] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[44px]">{p.name}</h2>
                  <p className="mt-4 max-w-[460px] text-[16px] leading-relaxed text-muted-foreground">{p.summary}</p>
                </Reveal>
                <Reveal delay={0.16}>
                  <dl className="mt-8 divide-y divide-[var(--glass-border)] border-y border-[var(--glass-border)]">
                    {facts.map(([a, b]) => (
                      <div key={a} className="grid grid-cols-[110px_1fr] gap-4 py-3 text-[13px]">
                        <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-faint">{a}</dt>
                        <dd className="text-foreground/90">{b}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-6">
                    <p className="label-mono mb-3">Blocks used</p>
                    <BlockRoles p={p} dense />
                  </div>
                  <div className="mt-8">
                    <PrimaryLink href={href("examples", ...p.key.split("/"))} className="h-11 px-5 text-[13px]">Open the project</PrimaryLink>
                  </div>
                </Reveal>
              </div>
              <div className={cn(i % 2 === 1 && "md:order-1")}>
                {run && (
                  <Reveal>
                    <Player run={run} compact autoplay loop />
                  </Reveal>
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- the flows of a recorded run */

/** Every recorded frame transaction of the project as a flow, plus the refused case: pick one to see which blocks it went
 *  through. Each one opens in the explorer by its hash. */
function RunFlows({ run, featured }: { run: Run; featured: string }) {
  const inc = run.steps.find((s) => s.stage === "include") as { tx?: string } | undefined;
  const items = [
    ...(run.story ?? []).filter((s) => s.flow).map((s) => ({ title: s.title, tx: s.tx, flow: s.flow!, refused: false })),
    ...(run.failing.flow ? [{ title: `Refused: ${run.failing.result}${run.failing.core ? ` (${run.failing.core})` : ""}`, tx: run.failing.tx ?? "", flow: run.failing.flow, refused: true }] : []),
  ];
  const start = Math.max(0, items.findIndex((x) => x.tx === inc?.tx));
  const [i, setI] = useState(start);
  const cur = items[i];
  if (!cur) return null;
  return (
    <div className="glass rounded-[28px] p-6">
      <p className="label-mono mb-3">How it works, transaction by transaction · featured: {featured}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((x, j) => (
          <button
            key={x.tx + j}
            onClick={() => setI(j)}
            className={cn(
              "max-w-[280px] truncate rounded-full border px-3 py-1.5 text-left text-[12px] transition-colors",
              j === i ? "border-foreground/40 bg-foreground/[0.07] text-foreground" : "border-[var(--glass-border)] text-muted-foreground hover:text-foreground",
              x.refused && "border-red-500/40",
            )}
            title={x.title}
          >
            {String(j + 1).padStart(2, "0")} · {x.flow.trigger} · {x.title}
          </button>
        ))}
      </div>
      <div className="mt-6">
        <FlowGraph key={i} flow={cur.flow} />
        <FlowVerdict flow={cur.flow} />
      </div>
      {cur.tx && (
        <a href={href("explorer", run.network.name === "local" ? "local" : "devnet1", cur.tx)} className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11.5px] text-muted-foreground hover:text-foreground">
          {cur.tx.slice(0, 18)}… · open in the explorer →
        </a>
      )}
    </div>
  );
}
