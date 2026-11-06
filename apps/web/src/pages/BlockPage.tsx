import { useEffect, useState } from "react";
import { motion, useScroll, useSpring } from "framer-motion";
import { ArrowLeft, ArrowRight, ArrowUpRight, FileCode2 } from "lucide-react";
import { Reveal } from "@/components/motion";
import { Code, GasTag, MempoolBadges, StatusBadge, fencedAll } from "@/components/bits";
import { BlockCard } from "@/pages/Blocks";
import { BLOCKS, READY_MADE, TIERS, blockById, projectsUsing, repoFile, shapeLabel, type Block } from "@/lib/catalog";
import { href } from "@/lib/route";
import { cn } from "@/lib/utils";

const prose = (s?: string) =>
  (s ?? "").split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i} className="rounded-md border border-[var(--glass-border)] bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{part}</code> : part));

/** A Markdown list as items, or the whole text as one item when it is not a list. */
const items = (md?: string) => {
  const lines = (md ?? "").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  return lines.length ? lines : md ? [md] : [];
};

const ROW = "grid gap-1 py-3 text-[14px] sm:grid-cols-[180px_1fr] sm:gap-4";

function codeFiles(m: Block) {
  return fencedAll(m.sections["Usage"]).map((c) => ({
    filename: c.lang === "ts" || c.lang === "typescript" ? "SDK (no Solidity)" : "Solidity",
    lang: c.lang,
    code: c.code,
  }));
}

export default function BlockPage({ id }: { id: string }) {
  const m = blockById(id);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 30 });
  const [active, setActive] = useState("what");

  const isCheck = m?.shape === "check" || m?.shape === "join" || m?.shape === "signer";
  const ready = m?.shape === "ready-made";
  const code = m ? codeFiles(m) : [];
  const limits = items(m?.sections["Gotchas"]);
  const uses = m?.useCases ?? { ready: [], configs: [], ideas: [] };
  const useGroups = [
    { t: "Ready to use", note: "a build or a recorded example already does this", list: uses.ready },
    { t: "Common configurations", note: "set the configuration; no new code", list: uses.configs },
    { t: "Other use cases", note: "not built yet", list: uses.ideas },
  ].filter((g) => g.list.length > 0);
  const used = m ? projectsUsing(m.id) : [];
  const related = (m?.related ?? []).map(blockById).filter(Boolean) as Block[];
  const builtFrom = m?.builtFrom ?? [];
  const siblings = ready ? READY_MADE : BLOCKS.filter((x) => x.shape === m?.shape);

  const toc = [
    { id: "what", t: "Overview" },
    ...(ready && (builtFrom.length || m?.sections["Composed of"]) ? [{ id: "built-from", t: "Composed of" }] : []),
    { id: "inputs", t: "Configuration" },
    ...(useGroups.length ? [{ id: "presets", t: "Use cases" }] : []),
    ...(used.length ? [{ id: "used-in", t: "In the examples" }] : []),
    ...(code.length || m?.code.length ? [{ id: "code", t: "Usage" }] : []),
    { id: "runs-on", t: "Mempool" },
    ...(m?.gas ? [{ id: "gas", t: "Gas" }] : []),
    ...(limits.length ? [{ id: "limits", t: "Gotchas" }] : []),
    ...(related.length ? [{ id: "related", t: "Works well with" }] : []),
  ];

  useEffect(() => {
    const on = () => {
      let cur = toc[0]?.id;
      for (const h of toc) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top < window.innerHeight * 0.35) cur = h.id;
      }
      setActive(cur);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  });

  if (!m) {
    return (
      <div className="px-6 pb-40 pt-40 text-center">
        <p className="label-mono">Not found</p>
        <h1 className="text-chrome mt-4 text-[40px] font-semibold">No block called “{id}”.</h1>
        <a href={href("blocks")} className="mt-8 inline-block text-[14px] text-muted-foreground underline underline-offset-4">Back to the blocks</a>
      </div>
    );
  }

  const tier = TIERS.find((t) => t.id === m.tier);
  const dir = ready ? "ready-made" : `${m.shape}s`;

  return (
    <div className="relative overflow-x-clip">
      <motion.div style={{ scaleX: progress }} className="fixed inset-x-0 top-0 z-[60] h-px origin-left bg-foreground/70" />

      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 pb-32 pt-32 sm:px-6 lg:grid-cols-[minmax(0,1fr)_200px]">
        <article className="min-w-0">
          <Reveal>
            <a href={href("blocks")} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3.5" /> Blocks
            </a>
          </Reveal>

          <Reveal delay={0.05} className="mt-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-foreground/30 px-2.5 py-1 font-mono text-[11px]">{shapeLabel(m)}</span>
              {tier && (
                <span className="rounded-full border border-[var(--glass-border)] px-2.5 py-1 font-mono text-[11px] text-muted-foreground" title={tier.title}>
                  {tier.title}
                </span>
              )}
              <StatusBadge status={m.status} />
            </div>
            <h1 className="text-chrome mt-5 text-[40px] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[60px]">{m.name}</h1>
            <p id="what" className="mt-5 max-w-[680px] scroll-mt-28 text-[17px] leading-relaxed text-foreground/85">{prose(m.summary)}</p>
          </Reveal>

          {/* built from (complete contracts) */}
          {ready && (builtFrom.length > 0 || m.sections["Composed of"]) && (
            <section id="built-from" className="mt-16 scroll-mt-28">
              <Reveal>
                <p className="label-mono mb-3">Composed of</p>
                <div className="glass rounded-[24px] p-6">
                  {m.sections["Composed of"] && <p className="text-[14px] leading-relaxed text-foreground/85">{prose(m.sections["Composed of"])}</p>}
                  {builtFrom.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {builtFrom.map((b) => {
                        const x = blockById(b);
                        return x ? (
                          <a key={b} href={href("blocks", b)} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-3 py-1.5 text-[12.5px] text-foreground hover:border-foreground/30">
                            <span className="font-mono text-[10.5px] text-faint">{shapeLabel(x)}</span> {x.name} <ArrowRight className="size-3" />
                          </a>
                        ) : (
                          <span key={b} className="rounded-full border border-[var(--glass-border)] px-3 py-1.5 font-mono text-[12px] text-muted-foreground">{b}</span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Reveal>
            </section>
          )}

          {/* inputs */}
          <section id="inputs" className="mt-16 scroll-mt-28">
            <Reveal>
              <p className="label-mono mb-3">Configuration</p>
              <dl className="divide-y divide-[var(--glass-border)] border-y border-[var(--glass-border)]">
                {m.inputs.map((x) => (
                  <div key={x.name} className={ROW}>
                    <dt className="font-mono text-[12.5px] text-foreground">{x.name}</dt>
                    <dd className="leading-relaxed text-foreground/85">{prose(x.what)}</dd>
                  </div>
                ))}
                {m.perTrigger && (
                  <div className={ROW}>
                    <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-faint">Trigger payload</dt>
                    <dd className="leading-relaxed text-foreground/85">{prose(m.perTrigger)}</dd>
                  </div>
                )}
                {m.output && (
                  <div className={ROW}>
                    <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-faint">{isCheck ? "Returns" : "Effect"}</dt>
                    <dd className="leading-relaxed text-foreground/85">{prose(m.output)}</dd>
                  </div>
                )}
              </dl>
            </Reveal>
          </section>

          {/* use cases, in three groups */}
          {useGroups.length > 0 && (
            <section id="presets" className="mt-16 scroll-mt-28">
              <Reveal>
                <p className="label-mono mb-3">Use cases</p>
                <div className="grid gap-4 md:grid-cols-3">
                  {useGroups.map((g) => (
                    <div key={g.t} className="glass rounded-[20px] p-5">
                      <p className="text-[14px] font-semibold tracking-tight">{g.t}</p>
                      <p className="mt-0.5 font-mono text-[10.5px] text-faint">{g.note}</p>
                      <ul className="mt-3 space-y-2">
                        {g.list.map((x) => (
                          <li key={x} className="text-[13px] leading-relaxed text-foreground/85">{prose(x)}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </Reveal>
            </section>
          )}

          {/* used in */}
          {used.length > 0 && (
            <section id="used-in" className="mt-16 scroll-mt-28">
              <Reveal>
                <p className="label-mono mb-3">In the examples</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {used.map((p) => {
                    const role = p.modules.find((x) => x.id === m.id)?.role;
                    return (
                      <a key={p.key} href={href("examples", ...p.key.split("/"))} className="glass group flex flex-col rounded-2xl p-5 transition-transform hover:-translate-y-0.5">
                        <span className="flex items-center justify-between gap-2 text-[15px] font-medium">
                          {p.name}
                          <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                        </span>
                        {role && <span className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{prose(role)}</span>}
                      </a>
                    );
                  })}
                </div>
              </Reveal>
            </section>
          )}

          {/* code */}
          {(code.length > 0 || m.code.length > 0) && (
            <section id="code" className="mt-16 scroll-mt-28">
              <Reveal>
                <p className="label-mono mb-3">Code</p>
                {code.length > 0 && <Code files={code} />}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {m.code.map((f) => (
                    <a key={f} href={repoFile(f)} target="_blank" rel="noreferrer" className="group flex items-center justify-between gap-3 rounded-xl border border-[var(--glass-border)] px-4 py-2.5 font-mono text-[12px] transition-colors hover:border-foreground/30 hover:bg-foreground/[0.03]">
                      <span className="flex min-w-0 items-center gap-2 text-foreground/90">
                        <FileCode2 className="size-3.5 shrink-0 text-faint" />
                        <span className="truncate">{f}</span>
                      </span>
                      <ArrowUpRight className="size-3.5 shrink-0 text-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </a>
                  ))}
                </div>
              </Reveal>
            </section>
          )}

          {/* where it runs (decision 67: positive chips only) */}
          <section id="runs-on" className="mt-16 scroll-mt-28">
            <Reveal>
              <p className="label-mono mb-3">Mempool</p>
              <div className="glass rounded-[24px] p-6">
                <MempoolBadges m={m} />
                {m.sections["Mempool"] && <p className="mt-4 text-[14px] leading-relaxed text-foreground/85">{prose(m.sections["Mempool"])}</p>}
              </div>
            </Reveal>
          </section>

          {m.gas && (
            <section id="gas" className="mt-12 scroll-mt-28">
              <Reveal>
                <p className="label-mono mb-3">Gas</p>
                <div className="glass rounded-[24px] p-6">
                  <GasTag m={m} />
                </div>
              </Reveal>
            </section>
          )}

          {/* limits */}
          {limits.length > 0 && (
            <section id="limits" className="mt-16 scroll-mt-28">
              <Reveal>
                <p className="label-mono mb-3">Gotchas</p>
                <ul className="divide-y divide-[var(--glass-border)] border-y border-[var(--glass-border)]">
                  {limits.map((l, i) => (
                    <li key={i} className="grid grid-cols-[32px_1fr] gap-3 py-4 text-[14px] leading-relaxed text-foreground/85">
                      <span className="font-pixel text-[13px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                      <span>{prose(l)}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
            </section>
          )}

          {/* related */}
          {related.length > 0 && (
            <section id="related" className="mt-16 scroll-mt-28">
              <p className="label-mono mb-4">Related</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((r, i) => (
                  <BlockCard key={r.id} m={r} i={i} />
                ))}
              </div>
            </section>
          )}
        </article>

        {/* on this page */}
        <aside className="hidden lg:block">
          <div className="sticky top-28">
            <p className="label-mono mb-3">On this page</p>
            <div className="relative border-l border-[var(--glass-border)]">
              {toc.map((h) => (
                <a
                  key={h.id}
                  href={`#${h.id}`}
                  onClick={(e) => (e.preventDefault(), document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" }))}
                  className={cn("relative block py-1.5 pl-4 text-[12.5px] transition-colors", active === h.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {active === h.id && <motion.span layoutId="mod-toc" className="absolute -left-px inset-y-1 w-px bg-foreground" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                  {h.t}
                </a>
              ))}
            </div>
            <div className="mt-8 space-y-1">
              <p className="label-mono mb-2">{ready ? "Complete contracts" : `${shapeLabel(m)}s`}</p>
              {siblings.map((x) => (
                <a key={x.id} href={href("blocks", x.id)} className={cn("block truncate text-[12.5px]", x.id === m.id ? "text-foreground" : "text-faint hover:text-muted-foreground")}>
                  {x.name}
                </a>
              ))}
            </div>
            <p className="mt-8 text-[11px] leading-relaxed text-faint">source docs/catalog/{dir}/{m.id}.md</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
