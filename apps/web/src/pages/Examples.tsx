import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { MetalNumeral } from "@/components/MetalNumeral";
import { BountyScene, ShieldScene, VaultScene } from "@/components/scenes";
import { Reveal } from "@/components/motion";
import { PrimaryLink } from "@/components/bits";
import { Player } from "@/player/Player";
import { MODULES, moduleById } from "@/lib/catalog";
import { RUNS, step } from "@/lib/runs";
import { href } from "@/lib/route";
import { cn } from "@/lib/utils";

const SCENES: Record<string, ReactNode> = {
  "pause/guarded-vault": <VaultScene />,
  "repay/partial-repay-shield": <ShieldScene />,
  "payout/proof-of-exploit-bounty": <BountyScene />,
};

const keys = Object.keys(RUNS).sort((a, b) => Number(!SCENES[a]) - Number(!SCENES[b]));
const moduleFor = (key: string) => MODULES.find((m) => m.example === key && m.id === RUNS[key].module) ?? MODULES.find((m) => m.example === key);

export default function Examples({ runKey }: { runKey?: string }) {
  return runKey && RUNS[runKey] ? <PlayerPage runKey={runKey} /> : <Index />;
}

/* ------------------------------------------------------------- one example */

function PlayerPage({ runKey }: { runKey: string }) {
  const run = RUNS[runKey];
  const m = moduleFor(runKey);
  const admit = step(run.steps, "admit");
  return (
    <div className="relative overflow-x-clip px-4 pb-24 pt-32 sm:px-6">
      <div className="mx-auto max-w-[1320px]">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <Reveal>
            <a href={href("examples")} className="label-mono hover:text-foreground">← Examples</a>
            <h1 className="text-chrome mt-4 text-[36px] font-semibold leading-[1.04] tracking-[-0.04em] md:text-[52px]">{run.title}</h1>
            <p className="mt-3 max-w-[680px] text-[14px] leading-relaxed text-muted-foreground">
              {m?.name} · {run.actors.caller} triggers, {run.actors.payer} pays · admitted by the {admit?.report.mempool} mempool.
            </p>
          </Reveal>
          {m && (
            <Reveal delay={0.1}>
              <a href={href("modules", m.corner, m.id)} className="glass inline-flex h-11 items-center gap-2 rounded-full px-5 text-[13px] text-muted-foreground hover:text-foreground">
                Module page <ArrowRight className="size-4" />
              </a>
            </Reveal>
          )}
        </div>

        <Reveal delay={0.15} className="mt-10">
          <Player run={run} autoplay />
        </Reveal>

        {!run.recorded && (
          <p className="mt-4 max-w-[860px] rounded-2xl border border-dashed border-foreground/20 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
            <span className="text-foreground">Sample run.</span> {run.note}
          </p>
        )}

        <div className="mt-14">
          <p className="label-mono mb-4">Other examples</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {keys.filter((k) => k !== runKey).map((k) => (
              <a key={k} href={href("examples", ...k.split("/"))} className="glass group rounded-2xl p-5 transition-transform hover:-translate-y-0.5">
                <p className="font-mono text-[11px] text-faint">{k}</p>
                <p className="mt-2 text-[14px] font-medium">{RUNS[k].title}</p>
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
    const els = keys.map((k) => document.getElementById(`ch-${k.replace("/", "-")}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && setActive(els.indexOf(e.target as HTMLElement))), { rootMargin: "-45% 0px -45% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="relative overflow-x-clip">
      <nav className="fixed left-8 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-4 xl:flex">
        {keys.map((k, i) => (
          <button key={k} onClick={() => document.getElementById(`ch-${k.replace("/", "-")}`)?.scrollIntoView({ behavior: "smooth" })} className="group flex items-center gap-3" aria-label={RUNS[k].title}>
            <span className={cn("h-px transition-all duration-500", i === active ? "w-10 bg-foreground" : "w-5 bg-foreground/25 group-hover:w-8")} />
            <span className={cn("font-pixel text-[13px] transition-colors", i === active ? "text-foreground" : "text-faint")}>{String(i + 1).padStart(2, "0")}</span>
          </button>
        ))}
      </nav>

      <section className="px-4 pb-10 pt-40 sm:px-6">
        <div className="mx-auto max-w-[1120px]">
          <Reveal>
            <p className="label-mono mb-4">Examples</p>
            <h1 className="text-chrome max-w-[860px] text-[42px] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[72px]">
              See it work
              <br />
              before you read a spec.
            </h1>
            <p className="mt-6 max-w-[580px] text-[17px] leading-relaxed text-muted-foreground">
              Each example replays one run in five stages, the transaction and the world side by side, then the paired run where the condition was false.
            </p>
          </Reveal>
        </div>
      </section>

      {keys.map((k, i) => {
        const run = RUNS[k];
        const m = moduleFor(k);
        const mod = m ? moduleById(m.id) : undefined;
        const facts: [string, string][] = [
          ["Caller", run.actors.caller],
          ["Who pays", run.actors.payer],
          ["Mempool", step(run.steps, "admit")?.report.mempool ?? "—"],
          ["When false", `${run.failing.result}${run.failing.core ? ` · Core ${run.failing.core}` : ""}, costs nothing`],
        ];
        return (
          <section key={k} id={`ch-${k.replace("/", "-")}`} className="flex min-h-screen items-center px-4 py-24 sm:px-6">
            <div className={cn("mx-auto grid w-full max-w-[1120px] items-center gap-14", i % 2 === 1 ? "md:grid-cols-[1.08fr_0.92fr]" : "md:grid-cols-[0.92fr_1.08fr]")}>
              <div className={cn(i % 2 === 1 && "md:order-2")}>
                <Reveal>
                  <MetalNumeral text={String(i + 1).padStart(2, "0")} height={130} />
                </Reveal>
                <Reveal delay={0.08}>
                  <p className="label-mono mt-6">{mod ? `${mod.corner} · ${mod.trigger}` : k}</p>
                  <h2 className="text-chrome mt-3 text-[36px] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[44px]">{mod?.name ?? run.title}</h2>
                  <p className="mt-4 max-w-[460px] text-[16px] leading-relaxed text-muted-foreground">{mod?.summary.replace(/`/g, "")}</p>
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
                  <div className="mt-8 flex flex-wrap items-center gap-3">
                    <PrimaryLink href={href("examples", ...k.split("/"))} className="h-11 px-5 text-[13px]">Play it</PrimaryLink>
                    {mod && (
                      <motion.a whileHover={{ x: 2 }} href={href("modules", mod.corner, mod.id)} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
                        Module page <ArrowUpRight className="size-3.5" />
                      </motion.a>
                    )}
                  </div>
                </Reveal>
              </div>
              <div className={cn(i % 2 === 1 && "md:order-1")}>
                {SCENES[k] ?? (
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
