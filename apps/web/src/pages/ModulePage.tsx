import { useEffect, useState } from "react";
import { motion, useScroll, useSpring } from "framer-motion";
import { ArrowLeft, ArrowUpRight, FileCode2 } from "lucide-react";
import { MetalNumeral } from "@/components/MetalNumeral";
import { Reveal } from "@/components/motion";
import { Code, GasTag, MempoolBadges, StatusBadge, fenced } from "@/components/bits";
import { ModuleCard } from "@/pages/Modules";
import { Player } from "@/player/Player";
import { CORNERS, MODULES, TRIGGER_TEXT, cornerById, moduleById, repoFile } from "@/lib/catalog";
import { runFor } from "@/lib/runs";
import { href } from "@/lib/route";
import { cn } from "@/lib/utils";

const prose = (s?: string) =>
  (s ?? "").split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i} className="rounded-md border border-[var(--glass-border)] bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{part}</code> : part));

export default function ModulePage({ corner, id }: { corner: string; id: string }) {
  const m = moduleById(id);
  const c = cornerById(corner);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 30 });
  const [active, setActive] = useState("what");

  const run = runFor(m?.example);
  const code = fenced(m?.sections["Code"]);
  const limits = (m?.sections["Limits"] ?? "").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  const related = (m?.related ?? []).map(moduleById).filter(Boolean) as NonNullable<ReturnType<typeof moduleById>>[];

  const toc = [
    { id: "what", t: "What it does" },
    { id: "when", t: "When it fires" },
    ...(run ? [{ id: "example", t: "The example" }] : []),
    { id: "mempool", t: "Mempool" },
    { id: "gas", t: "Gas" },
    ...(code || m?.code.length ? [{ id: "code", t: "Code" }] : []),
    ...(limits.length ? [{ id: "limits", t: "Limits" }] : []),
    ...(related.length ? [{ id: "related", t: "Related" }] : []),
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

  if (!m || !c) {
    return (
      <div className="px-6 pb-40 pt-40 text-center">
        <p className="label-mono">Not found</p>
        <h1 className="text-chrome mt-4 text-[40px] font-semibold">No module called “{id}”.</h1>
        <a href={href("modules")} className="mt-8 inline-block text-[14px] text-muted-foreground underline underline-offset-4">Back to the catalog</a>
      </div>
    );
  }

  const idx = MODULES.filter((x) => x.corner === m.corner).findIndex((x) => x.id === m.id) + 1;

  return (
    <div className="relative overflow-x-clip">
      <motion.div style={{ scaleX: progress }} className="fixed inset-x-0 top-0 z-[60] h-px origin-left bg-foreground/70" />

      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 pb-32 pt-32 sm:px-6 lg:grid-cols-[minmax(0,1fr)_200px]">
        <article className="min-w-0">
          <Reveal>
            <a href={href("modules", c.id)} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3.5" /> {c.name}
            </a>
          </Reveal>

          <div className="mt-8 grid items-end gap-8 md:grid-cols-[1fr_auto]">
            <Reveal delay={0.05}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={m.status} />
                <span className="rounded-full border border-[var(--glass-border)] px-2.5 py-1 font-mono text-[11px] text-muted-foreground" title={TRIGGER_TEXT[m.trigger]}>
                  trigger · {m.trigger}
                </span>
                {m.postQuantum && <span className="rounded-full border border-foreground/30 px-2.5 py-1 font-mono text-[11px]">post-quantum</span>}
              </div>
              <h1 className="text-chrome mt-5 text-[40px] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[60px]">{m.name}</h1>
              <p id="what" className="mt-5 max-w-[640px] scroll-mt-28 text-[17px] leading-relaxed text-foreground/85">{prose(m.summary)}</p>
            </Reveal>
            <Reveal delay={0.1} className="hidden md:block">
              <MetalNumeral text={String(idx).padStart(2, "0")} height={120} />
            </Reveal>
          </div>

          {/* when / then */}
          <Reveal className="mt-14">
            <div id="when" className="grid scroll-mt-28 gap-4 md:grid-cols-2">
              {[
                ["When it fires", m.sections["When it fires"]],
                ["What it does then", m.sections["What it does then"]],
              ].map(([k, v]) => (
                <div key={k} className="glass rounded-[24px] p-6">
                  <p className="label-mono">{k}</p>
                  <p className="mt-3 text-[14px] leading-relaxed text-foreground/85">{prose(v)}</p>
                </div>
              ))}
            </div>
          </Reveal>

          {/* example */}
          {run && (
            <section id="example" className="mt-20 scroll-mt-28">
              <Reveal>
                <p className="label-mono mb-3">The example</p>
                <h2 className="text-chrome text-[30px] font-semibold tracking-[-0.03em]">{run.title}</h2>
                <p className="mt-2 max-w-[640px] text-[14px] text-muted-foreground">{run.recorded ? `Recorded on ${run.network.name}.` : run.note}</p>
              </Reveal>
              <Reveal className="mt-8">
                <Player run={run} compact autoplay />
              </Reveal>
              <a href={href("examples", ...m.example!.split("/"))} className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
                Open the full player with the raw data <ArrowUpRight className="size-3.5" />
              </a>
            </section>
          )}

          {/* where it runs (decision 67: positive chips only) */}
          <section id="mempool" className="mt-20 scroll-mt-28">
            <Reveal>
              <p className="label-mono mb-3">Runs on</p>
              <div className="glass rounded-[24px] p-6">
                <MempoolBadges m={m} />
                <p className="mt-4 text-[14px] leading-relaxed text-foreground/85">{prose(m.sections["Runs on"])}</p>
              </div>
            </Reveal>
          </section>

          <section id="gas" className="mt-12 scroll-mt-28">
            <Reveal>
              <p className="label-mono mb-3">Gas</p>
              <div className="glass rounded-[24px] p-6 font-mono text-[12px]">
                <GasTag m={m} />
                {[
                  ["public", 100_000],
                  ["local · unstaked", 250_000],
                  ["local · staked", 2_500_000],
                ].map(([k, cap]) => {
                  const v = m.gas?.validation ?? 0;
                  const pct = v ? Math.min(100, (v / Number(cap)) * 100) : 0;
                  return (
                    <div key={String(k)} className="mt-5">
                      <div className="mb-2 flex justify-between text-muted-foreground">
                        <span>{v ? (v <= Number(cap) ? "✓" : "✕") : "·"} {k}</span>
                        <span>budget {Number(cap).toLocaleString("en-US")}</span>
                      </div>
                      <div className="relative h-2 rounded-full bg-foreground/[0.07]">
                        <motion.div initial={{ width: 0 }} whileInView={{ width: `${pct}%` }} viewport={{ once: true }} transition={{ duration: 1, ease: [0.2, 0.7, 0.2, 1] }} className={cn("absolute inset-y-0 left-0 rounded-full", v <= Number(cap) ? "bg-foreground" : "bg-foreground/40")} />
                      </div>
                    </div>
                  );
                })}
                {!m.gas && <p className="mt-4 text-faint">Validation gas for this module has not been measured yet; the bars fill once a recorded run reports it.</p>}
              </div>
            </Reveal>
          </section>

          {/* code */}
          {(code || m.code.length > 0) && (
            <section id="code" className="mt-20 scroll-mt-28">
              <Reveal>
                <p className="label-mono mb-3">Code</p>
                {code && <Code files={[{ filename: m.code.find((f) => f.endsWith(".ts")) ?? m.code[0] ?? "example", lang: code.lang, code: code.code }]} />}
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

          {/* limits */}
          {limits.length > 0 && (
            <section id="limits" className="mt-20 scroll-mt-28">
              <Reveal>
                <p className="label-mono mb-3">Limits</p>
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
            <section id="related" className="mt-20 scroll-mt-28">
              <p className="label-mono mb-4">Related modules</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((r, i) => (
                  <ModuleCard key={r.id} m={r} i={i} />
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
              <p className="label-mono mb-2">{c.name}</p>
              {MODULES.filter((x) => x.corner === c.id).map((x) => (
                <a key={x.id} href={href("modules", x.corner, x.id)} className={cn("block truncate text-[12.5px]", x.id === m.id ? "text-foreground" : "text-faint hover:text-muted-foreground")}>
                  {x.name}
                </a>
              ))}
            </div>
            <p className="mt-8 text-[11px] leading-relaxed text-faint">Corner {CORNERS.findIndex((x) => x.id === c.id) + 1} of 8 · source docs/catalog/{c.id}/{m.id}.md</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
