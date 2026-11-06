import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { RULES_BY_ID } from "@popcorn/simulator";
import { DecryptReveal } from "@/components/effects/DecryptReveal";
import { Kbd } from "@/components/ui/kbd";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useScramble } from "@/lib/useScramble";
import { STAGES, STAGE_NAME, fmt, step, type Run, type RunFrame, type RunStep, type Stage } from "@/lib/runs";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ beats */

// A beat is one thing appearing on screen: a frame, a read, a check, the inclusion, the result. Stepping moves one beat.
type Beat = { stage: Stage; i: number; last: boolean };

function beatsOf(steps: RunStep[]): Beat[] {
  const out: Beat[] = [];
  for (const s of steps) {
    const n =
      s.stage === "build" ? s.frames.length :
      s.stage === "validate" ? s.reads.length + 1 :
      s.stage === "admit" ? s.report.checks.length + 1 :
      s.stage === "act" ? 1 + (s.events?.length ?? 0) : 1;
    for (let i = 0; i < n; i++) out.push({ stage: s.stage, i, last: i === n - 1 });
  }
  return out;
}

const TERMS: Record<string, string> = {
  VERIFY: "A validation frame. It runs before anything is paid for and must approve the transaction; if it does not, the transaction is invalid and costs nothing.",
  SENDER: "The frame that runs the action, as the rule contract.",
  DEFAULT: "An ordinary call frame after the action.",
  flags: "Which approvals the frame may give: 1 payment, 2 execution, 3 both.",
  "nonce key": "An EIP-8250 nonce key. Each event gets one key, so it can fire once.",
};

function Term({ k, children }: { k: string; children?: ReactNode }) {
  return (
    <span title={TERMS[k]} className="cursor-help underline decoration-foreground/20 decoration-dotted underline-offset-4">
      {children ?? k}
    </span>
  );
}

/* ----------------------------------------------------------------- player */

export function Player({ run, autoplay = false, compact = false, loop = false }: { run: Run; autoplay?: boolean; compact?: boolean; loop?: boolean }) {
  const reduce = useReducedMotion();
  const [failing, setFailing] = useState(false);
  const steps = failing ? run.failing.steps : run.steps;
  const beats = useMemo(() => beatsOf(steps), [steps]);
  const [pos, setPos] = useState(autoplay ? 0 : beats.length - 1);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState(1);
  const root = useRef<HTMLDivElement>(null);
  const cur = beats[Math.min(pos, beats.length - 1)];
  const stageIdx = STAGES.indexOf(cur.stage);

  // where each stage is: done, current (with how many beats shown), or not reached
  const shown = useCallback(
    (stage: Stage) => {
      const si = STAGES.indexOf(stage);
      if (si < stageIdx) return Infinity;
      if (si > stageIdx) return -1;
      return cur.i;
    },
    [stageIdx, cur.i],
  );

  useEffect(() => {
    if (!playing) return;
    if (pos >= beats.length - 1) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setPos((p) => p + 1), (cur.last ? 1500 : 850) / speed);
    return () => clearTimeout(t);
  }, [playing, pos, beats.length, speed, cur.last]);

  // the hero copy loops on its own: the passing run, then the failing one, then again
  useEffect(() => {
    if (!loop || playing || pos < beats.length - 1) return;
    const t = window.setTimeout(() => {
      setFailing((f) => !f);
      setPos(0);
      setPlaying(true);
    }, 3200);
    return () => clearTimeout(t);
  }, [loop, playing, pos, beats.length]);

  const toggleFailing = useCallback(() => {
    setFailing((f) => !f);
    setPos(0);
    setPlaying(true);
  }, []);

  const go = useCallback((d: number) => {
    setPlaying(false);
    setPos((p) => Math.max(0, Math.min(beats.length - 1, p + d)));
  }, [beats.length]);

  // keyboard: only while the player has focus or is the page's main player
  useEffect(() => {
    if (compact) return;
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      if (e.key === " ") {
        e.preventDefault();
        if (pos >= beats.length - 1) setPos(0);
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight" || e.key === "l") go(1);
      else if (e.key === "ArrowLeft" || e.key === "h") go(-1);
      else if (e.key === "f") toggleFailing();
      else if (e.key === "r") (setPos(0), setPlaying(true));
      else if (/^[1-5]$/.test(e.key)) {
        const target = STAGES[Number(e.key) - 1];
        const idx = beats.findIndex((b) => b.stage === target);
        if (idx >= 0) (setPlaying(false), setPos(idx + beats.filter((b) => b.stage === target).length - 1));
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [compact, go, toggleFailing, pos, beats]);

  const reached = new Set(beats.map((b) => b.stage));
  const curStep = steps.find((s) => s.stage === cur.stage);

  const views = {
    tx: <TxView steps={steps} shown={shown} stage={cur.stage} failing={failing} run={run} reduce={!!reduce} />,
    world: <WorldView steps={steps} shown={shown} stage={cur.stage} run={run} failing={failing} />,
  };

  return (
    <div ref={root} className="glass-strong border-spin rounded-[22px] p-1.5" data-cursor>
      <div className="overflow-hidden rounded-[17px] border border-[var(--glass-border)] bg-background/70">
        {/* title bar */}
        <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--glass-border)] px-4 py-2">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-2.5 rounded-full bg-foreground/15" />
            ))}
          </div>
          <span className="truncate font-mono text-[12px] text-muted-foreground">
            examples / {run.module}
            {failing && <span className="text-foreground"> · failing case</span>}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {!run.recorded && (
              <span title={run.note} className="cursor-help rounded-full border border-dashed border-foreground/30 px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                sample run
              </span>
            )}
            <span className="rounded-full border border-[var(--glass-border)] px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {run.network.name} · {run.network.chainId}
            </span>
          </div>
        </div>

        {/* stage rail */}
        <div className="grid grid-cols-5 border-b border-[var(--glass-border)]">
          {STAGES.map((s, i) => {
            const on = i <= stageIdx;
            const there = reached.has(s);
            return (
              <button
                key={s}
                disabled={!there}
                onClick={() => {
                  setPlaying(false);
                  const idx = beats.findIndex((b) => b.stage === s);
                  setPos(idx + beats.filter((b) => b.stage === s).length - 1);
                }}
                className={cn("relative px-2 py-3 text-left transition-colors disabled:cursor-not-allowed", on ? "text-foreground" : "text-faint", !there && "line-through decoration-foreground/20")}
              >
                <span className="font-pixel text-[11px] text-faint">0{i + 1}</span>
                <span className="ml-1.5 text-[12px] font-medium sm:text-[13px]">{STAGE_NAME[s]}</span>
                <span className="absolute inset-x-0 bottom-0 h-px bg-[var(--glass-border)]" />
                {i === stageIdx && <motion.span layoutId={`stage-${run.module}-${compact}`} className="absolute inset-x-0 bottom-0 h-[2px] bg-foreground" transition={{ type: "spring", stiffness: 380, damping: 34 }} />}
              </button>
            );
          })}
        </div>

        {/* views */}
        {compact ? (
          <div className="grid min-h-[380px] grid-cols-1 md:grid-cols-[1.1fr_0.9fr]">
            <div className="border-[var(--glass-border)] md:border-r">{views.tx}</div>
            <div className="hidden md:block">{views.world}</div>
          </div>
        ) : (
          <>
            <div className="hidden min-h-[520px] md:block">
              <ResizablePanelGroup orientation="horizontal" className="min-h-[520px]">
                <ResizablePanel defaultSize="40%" minSize="28%">{views.tx}</ResizablePanel>
                <ResizableHandle className="bg-[var(--glass-border)]" />
                <ResizablePanel defaultSize="34%" minSize="24%">{views.world}</ResizablePanel>
                <ResizableHandle className="bg-[var(--glass-border)]" />
                <ResizablePanel defaultSize="26%" minSize="18%">
                  <RawPanel step={curStep} run={run} />
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
            <div className="md:hidden">
              {views.tx}
              <div className="border-t border-[var(--glass-border)]">{views.world}</div>
            </div>
          </>
        )}

        {/* controls */}
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--glass-border)] px-4 py-3">
          <div className="flex items-center gap-1">
            <CtlButton label="Step back" onClick={() => go(-1)}><ChevronLeft className="size-4" /></CtlButton>
            <button
              onClick={() => {
                if (pos >= beats.length - 1) setPos(0);
                setPlaying((p) => !p);
              }}
              aria-label={playing ? "Pause" : "Play"}
              className="grid size-9 place-items-center rounded-full bg-foreground text-background"
            >
              {playing ? <Pause className="size-4" /> : pos >= beats.length - 1 ? <RotateCcw className="size-4" /> : <Play className="size-4" />}
            </button>
            <CtlButton label="Step forward" onClick={() => go(1)}><ChevronRight className="size-4" /></CtlButton>
          </div>

          <input
            type="range"
            min={0}
            max={beats.length - 1}
            value={pos}
            onChange={(e) => (setPlaying(false), setPos(Number(e.target.value)))}
            aria-label="Scrub"
            className="h-1.5 min-w-[120px] flex-1 cursor-pointer appearance-none rounded-full bg-foreground/10 accent-foreground"
          />

          <div className="flex items-center gap-1 font-mono text-[11px]">
            {[0.5, 1, 2].map((s) => (
              <button key={s} onClick={() => setSpeed(s)} className={cn("rounded-full px-2 py-1", speed === s ? "bg-foreground/10 text-foreground" : "text-faint hover:text-foreground")}>
                {s}×
              </button>
            ))}
          </div>

          <button
            onClick={toggleFailing}
            role="switch"
            aria-checked={failing}
            className="flex items-center gap-2.5 rounded-full border border-[var(--glass-border)] py-1 pl-1 pr-3 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className={cn("relative h-5 w-9 rounded-full border transition-colors", failing ? "border-foreground/50 bg-foreground" : "border-[var(--glass-border)] bg-foreground/10")}>
              <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }} className={cn("absolute top-0.5 size-[14px] rounded-full", failing ? "right-0.5 bg-background" : "left-0.5 bg-foreground/60")} />
            </span>
            Try the failing case
          </button>

          {!compact && (
            <div className="hidden items-center gap-3 font-mono text-[11px] text-faint xl:flex">
              <span className="flex items-center gap-1"><Kbd>␣</Kbd> play</span>
              <span className="flex items-center gap-1"><Kbd>←</Kbd><Kbd>→</Kbd> step</span>
              <span className="flex items-center gap-1"><Kbd>1</Kbd>–<Kbd>5</Kbd> stage</span>
              <span className="flex items-center gap-1"><Kbd>F</Kbd> failing</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CtlButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground">
      {children}
    </button>
  );
}

/* --------------------------------------------------------- transaction view */

const enter = { initial: { opacity: 0, y: 10, filter: "blur(6px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" }, transition: { duration: 0.4, ease: [0.2, 0.7, 0.2, 1] as const } };

function TxView({ steps, shown, stage, failing, run, reduce }: { steps: RunStep[]; shown: (s: Stage) => number; stage: Stage; failing: boolean; run: Run; reduce: boolean }) {
  const build = step(steps, "build");
  const validate = step(steps, "validate");
  const admit = step(steps, "admit");
  const include = step(steps, "include");
  const nb = shown("build");
  const nv = shown("validate");
  const na = shown("admit");
  const inBlock = shown("include") >= 0 && include;
  const acting = shown("act") >= 0;
  const e = reduce ? {} : enter;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center justify-between">
        <p className="label-mono">Transaction</p>
        <AnimatePresence mode="wait">
          {inBlock ? (
            <motion.span key="blk" {...e} className="rounded-full bg-foreground px-2.5 py-0.5 font-mono text-[11px] text-background">
              in block {include.block ? fmt(include.block) : "—"}
            </motion.span>
          ) : (
            <motion.span key="pool" {...e} className="font-mono text-[11px] text-faint">
              {stage === "admit" ? "in the mempool" : "not sent"}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <motion.div layout className={cn("space-y-2 rounded-2xl transition-colors duration-500", inBlock && "border border-foreground/30 bg-foreground/[0.03] p-2")}>
        <AnimatePresence initial={false}>
          {build?.frames.map((f, i) =>
            i <= nb ? (
              <motion.div key={(failing ? "f" : "s") + i} {...e} layout>
                <FrameCard f={f} i={i} lit={(f.mode === "VERIFY" && stage === "validate") || (f.mode === "SENDER" && acting)} />
                {f.mode === "VERIFY" && i === 0 && nv >= 0 && validate && (
                  <div className="ml-4 mt-2 space-y-1 border-l border-[var(--glass-border)] pl-4">
                    {validate.reads.map((r, j) =>
                      j <= nv ? (
                        <motion.div key={j} {...e} className="flex items-start justify-between gap-3 py-1 font-mono text-[11.5px]">
                          <span className="text-muted-foreground">{r.label}</span>
                          <span className="shrink-0 text-right text-foreground">
                            {r.value}
                            <span className="ml-2 text-faint">{fmt(r.gas)}</span>
                          </span>
                        </motion.div>
                      ) : null,
                    )}
                    {nv > validate.reads.length - 1 && (
                      <motion.div
                        {...(reduce ? {} : { initial: { opacity: 0, scale: 1.15, filter: "blur(8px)" }, animate: { opacity: 1, scale: 1, filter: "blur(0px)" }, transition: { type: "spring", stiffness: 300, damping: 22 } })}
                        className={cn("mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[12px]", validate.result === "READY" ? "border-foreground bg-foreground text-background" : "border-foreground/40")}
                      >
                        {validate.result === "READY" ? "APPROVE" : `✕ ${validate.result}`}
                        {run.failing.core && validate.result !== "READY" && <span className="opacity-60">Core {run.failing.core}</span>}
                        <span className="opacity-60">· {fmt(validate.gasUsed)} gas</span>
                      </motion.div>
                    )}
                  </div>
                )}
              </motion.div>
            ) : null,
          )}
        </AnimatePresence>
      </motion.div>

      {na >= 0 && admit && (
        <div className="space-y-1.5">
          <p className="label-mono mt-2">Admission · {admit.report.mempool}</p>
          {admit.report.checks.map((c, j) => (j <= na ? <CheckRow key={j + (failing ? "f" : "s")} c={c} /> : null))}
          {na > admit.report.checks.length - 1 && (
            <motion.p {...e} className="pt-2 font-mono text-[12px]">
              {admit.report.outcome === "accepted" ? "✓ accepted" : "✕ invalid · never included · costs nothing"}
            </motion.p>
          )}
        </div>
      )}
    </div>
  );
}

function FrameCard({ f, i, lit }: { f: RunFrame; i: number; lit: boolean }) {
  return (
    <div className={cn("rounded-2xl border p-3.5 transition-all duration-500", lit ? "border-foreground/50 bg-foreground/[0.07] shadow-[0_0_0_4px_color-mix(in_srgb,var(--foreground)_4%,transparent)]" : "border-[var(--glass-border)] bg-foreground/[0.02]")}>
      <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
        <span className="flex items-center gap-2">
          <span className="text-faint">frame {i}</span>
          <span className="text-foreground"><Term k={f.mode} /></span>
          <span className="text-faint"><Term k="flags">flags {f.flags}</Term></span>
        </span>
        <span className={cn("size-2 rounded-full transition-all duration-500", lit ? "bg-foreground shadow-[0_0_10px_color-mix(in_srgb,var(--foreground)_70%,transparent)]" : "bg-foreground/15")} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[12.5px]">
        <span className="text-foreground/90">→ {f.target}</span>
        <span className="font-mono text-[11px] text-muted-foreground">limit {fmt(f.gasLimit)}</span>
      </div>
      {f.explain && <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">{f.explain}</p>}
    </div>
  );
}

function CheckRow({ c }: { c: { rule: string; verdict: string; detail: string } }) {
  const detail = useScramble(c.detail, true, 500);
  const rule = RULES_BY_ID.get(c.rule);
  return (
    <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-start gap-3 rounded-xl border border-[var(--glass-border)] bg-background/40 px-3 py-2 font-mono text-[11.5px]">
      <span className={cn("mt-px w-3 shrink-0", c.verdict === "pass" ? "text-foreground" : "text-muted-foreground")}>{c.verdict === "pass" ? "✓" : c.verdict === "warn" ? "!" : "✕"}</span>
      <span className="min-w-0">
        <span title={rule ? `${rule.title}. ${rule.sentence} Fix: ${rule.fix}` : undefined} className="cursor-help text-foreground">
          {c.rule}
        </span>
        <span className="block text-muted-foreground">{detail}</span>
      </span>
    </motion.div>
  );
}

/* ---------------------------------------------------------------- world view */

function WorldView({ steps, shown, stage, run, failing }: { steps: RunStep[]; shown: (s: Stage) => number; stage: Stage; run: Run; failing: boolean }) {
  const build = step(steps, "build");
  const admit = step(steps, "admit");
  const include = step(steps, "include");
  const act = step(steps, "act");
  const na = shown("admit");
  const ent = admit?.report.entity;

  return (
    <div className="relative flex h-full flex-col gap-4 overflow-y-auto p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--border-strong)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)] opacity-60" />
      <p className="label-mono relative">World</p>

      {/* actors */}
      <div className="relative flex items-center gap-2 font-mono text-[11.5px]">
        <Actor on={stage === "build" || stage === "admit"}>{run.actors.caller}</Actor>
        <div className="relative h-px min-w-6 flex-1 bg-[var(--glass-border)]">
          {(stage === "admit" || stage === "include") && !failing && (
            <motion.span
              key={stage}
              initial={{ left: "0%" }}
              animate={{ left: "100%" }}
              transition={{ duration: 1.1, ease: "easeInOut" }}
              className="absolute -top-[3px] size-[7px] -translate-x-1/2 rounded-full bg-foreground shadow-[0_0_12px_3px_color-mix(in_srgb,var(--foreground)_50%,transparent)]"
            />
          )}
          {failing && shown("admit") >= 0 && <span className="absolute left-1/2 top-1/2 grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-foreground/50 bg-background">✕</span>}
        </div>
        <Actor on={stage === "validate" || stage === "act"}>{run.actors.ruleContract}</Actor>
      </div>

      {/* state */}
      <AnimatePresence mode="wait">
        {stage === "act" && act ? (
          <motion.div key="act" {...enter} className="relative space-y-1">
            <p className="label-mono mb-2">Before → after</p>
            {Object.keys(act.after).map((k, i) => (
              <motion.div key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.12 }} className="grid grid-cols-[1fr_auto] gap-3 border-t border-[var(--glass-border)] py-2 font-mono text-[12px]">
                <span className="text-muted-foreground">{k}</span>
                <span>
                  <span className="text-faint line-through decoration-foreground/30">{act.before[k] ?? "—"}</span>
                  <span className="mx-2 text-faint">→</span>
                  <span className="text-foreground">{act.after[k]}</span>
                </span>
              </motion.div>
            ))}
            {act.events?.map((ev, i) => (i < shown("act") ? <motion.p key={ev} {...enter} className="pt-2 font-mono text-[11.5px] text-muted-foreground">⟶ {ev}</motion.p> : null))}
          </motion.div>
        ) : stage === "include" && include ? (
          <motion.div key="inc" {...enter} className="relative grid grid-cols-2 gap-3">
            <Stat k="block" v={include.block ? fmt(include.block) : "—"} />
            <Stat k="status" v={include.status} />
            <Stat k="gas used" v={fmt(include.gasUsed)} />
            <Stat k="paid by" v={include.payer} />
          </motion.div>
        ) : stage === "admit" && admit ? (
          <motion.div key="adm" {...enter} className="relative space-y-4">
            <div className="flex flex-wrap gap-2 font-mono text-[11px]">
              <Actor on>{admit.report.mempool.includes("alt") ? "sidecar · ERC-8421" : "ethrex · EIP-8141"}</Actor>
              {ent && <Actor on={ent.staked}>{ent.staked ? "staked in the registry" : "unstaked"}</Actor>}
            </div>
            {ent && (
              <div className="font-mono text-[11.5px]">
                <div className="mb-2 flex justify-between text-muted-foreground">
                  <span>{ent.name} validation budget</span>
                  <span>
                    {fmt(ent.used)} / {fmt(ent.budget)}
                  </span>
                </div>
                <div className="relative h-2 rounded-full bg-foreground/[0.07]">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: na >= 0 ? `${Math.max(2, Math.min(100, (ent.used / ent.budget) * 100))}%` : 0 }}
                    transition={{ duration: 1, ease: [0.2, 0.7, 0.2, 1] }}
                    className="absolute inset-y-0 left-0 rounded-full bg-foreground"
                  />
                  {ent.budget > 100_000 && <div className="absolute -top-1.5 h-5 w-px bg-foreground/50" style={{ left: `${(100_000 / ent.budget) * 100}%` }} title="public 100,000" />}
                </div>
                {ent.budget > 100_000 && <p className="mt-1.5 text-faint">tick: the public mempool's 100,000</p>}
              </div>
            )}
          </motion.div>
        ) : build ? (
          <motion.div key="bld" {...enter} className="relative space-y-1">
            {Object.entries(build.world).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[1fr_auto] gap-3 border-t border-[var(--glass-border)] py-2 font-mono text-[12px]">
                <span className="text-muted-foreground">{k}</span>
                <span className="text-foreground">{v}</span>
              </div>
            ))}
            {stage === "validate" && <p className="pt-3 text-[12px] text-muted-foreground">The rule contract reads its condition. Nothing has been paid yet.</p>}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Actor({ on, children }: { on?: boolean; children: ReactNode }) {
  return (
    <span title={typeof children === "string" ? children : undefined} className={cn("min-w-0 max-w-[48%] truncate whitespace-nowrap rounded-full border px-3 py-1.5 transition-colors duration-500", on ? "border-foreground/40 text-foreground" : "border-[var(--glass-border)] text-muted-foreground")}>{children}</span>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-2xl border border-[var(--glass-border)] bg-background/40 p-3">
      <p className="label-mono">{k}</p>
      <p className="mt-2 font-pixel text-[22px] leading-none">{v}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ raw json */

function RawPanel({ step: s, run }: { step?: RunStep; run: Run }) {
  const text = JSON.stringify(s ?? {}, null, 2);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--glass-border)] px-4 py-3">
        <p className="label-mono">Raw step</p>
        <span className="font-mono text-[10px] text-faint">{s?.stage}</span>
      </div>
      <DecryptReveal className="min-h-0 flex-1" radius={120} cell={11} passthrough={0.05} scramble={0.3}>
        <pre className="h-full overflow-auto p-4 font-mono text-[11px] leading-[1.6] text-muted-foreground">{text}</pre>
      </DecryptReveal>
      <div className="space-y-1 border-t border-[var(--glass-border)] px-4 py-3 font-mono text-[10.5px] text-faint">
        {Object.entries(run.sources).map(([k, v]) => (
          <p key={k}>
            {k}: <span className="text-muted-foreground">{v}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
