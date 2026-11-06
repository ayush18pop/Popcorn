import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useInView } from "framer-motion";
import { useScramble } from "@/lib/useScramble";
import { cn } from "@/lib/utils";

// Small looping scenes for the featured examples. Each one restates the example's own facts (threshold, action, who
// pays) and is labelled as an illustration; the player is where recorded numbers live.

function usePhases(durations: number[]) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const [phase, setPhase] = useState(0);
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const t = window.setTimeout(() => {
      setPhase((p) => {
        const n = (p + 1) % durations.length;
        if (n === 0) setCycle((c) => c + 1);
        return n;
      });
    }, durations[phase]);
    return () => clearTimeout(t);
  }, [inView, phase, durations]);
  return { ref, phase, cycle };
}

function Tick({ from, to, decimals, ms = 1800, run }: { from: number; to: number; decimals: number; ms?: number; run: unknown }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const c = animate(from, to, { duration: ms / 1000, ease: "easeInOut", onUpdate: (v) => el.current && (el.current.textContent = v.toFixed(decimals)) });
    return () => c.stop();
  }, [from, to, decimals, ms, run]);
  return <span ref={el}>{from.toFixed(decimals)}</span>;
}

export function SceneFrame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="glass relative aspect-[5/4] w-full overflow-hidden rounded-[32px]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--border-strong)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <span className="label-mono absolute left-6 top-5">{label}</span>
      <span className="absolute right-6 top-5 flex items-center gap-1.5 font-mono text-[10px] text-faint">
        <span className="size-1.5 animate-pulse rounded-full bg-foreground/60" /> illustration
      </span>
      <div className="absolute inset-0 flex flex-col justify-center px-6 pb-4 pt-14 sm:px-10">{children}</div>
    </div>
  );
}

function Pill({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 font-mono text-[12px] transition-colors duration-500", on ? "border-foreground/40 text-foreground" : "border-[var(--glass-border)] text-muted-foreground")}>
      <span className={cn("size-1.5 rounded-full transition-all duration-500", on ? "bg-foreground shadow-[0_0_8px_color-mix(in_srgb,var(--foreground)_70%,transparent)]" : "bg-foreground/25")} />
      {children}
    </span>
  );
}

function Result({ show, children, delay = 0 }: { show: boolean; children: ReactNode; delay?: number }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0 }}
          transition={{ delay, duration: 0.45 }}
          className="flex items-center justify-between gap-4 border-t border-[var(--glass-border)] py-2.5 font-mono text-[12px]"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const big = "font-pixel text-[56px] leading-none sm:text-[84px]";

/** Partial Repay Shield: health falls below 1.1, a searcher triggers and pays, a quarter of the debt is repaid. */
export function ShieldScene() {
  const { ref, phase, cycle } = usePhases([2400, 1400, 3200]);
  return (
    <div ref={ref}>
      <SceneFrame label="partial repay shield · caller pays">
        <p className="label-mono">health factor</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <p className={big}>{phase === 0 ? <Tick key={cycle} from={1.25} to={1.08} decimals={2} ms={2000} run={cycle} /> : "1.08"}</p>
          <Pill on={phase > 0}>{phase > 0 ? "condition true" : "threshold 1.10"}</Pill>
        </div>
        <div className="mt-6 flex items-center gap-3 font-mono text-[12px]">
          <span className={cn("rounded-full border px-3 py-1.5 transition-colors", phase >= 1 ? "border-foreground/40" : "border-[var(--glass-border)] text-muted-foreground")}>searcher</span>
          <div className="relative h-px flex-1 bg-[var(--glass-border)]">
            {phase === 1 && (
              <motion.span initial={{ left: "0%" }} animate={{ left: "100%" }} transition={{ duration: 1.1, ease: "easeInOut" }} className="absolute -top-[3px] size-[7px] -translate-x-1/2 rounded-full bg-foreground shadow-[0_0_12px_3px_color-mix(in_srgb,var(--foreground)_50%,transparent)]" />
            )}
            {phase === 2 && <div className="absolute inset-0 bg-foreground/70" />}
          </div>
          <span className={cn("rounded-full border px-3 py-1.5 transition-colors", phase === 2 ? "border-foreground/40" : "border-[var(--glass-border)] text-muted-foreground")}>shield</span>
        </div>
        <div className="mt-6">
          <Result show={phase === 2}><span className="text-muted-foreground">repaid</span><span>a quarter of the debt</span></Result>
          <Result show={phase === 2} delay={0.2}><span className="text-muted-foreground">reward to the payer</span><span>0.5% of the repayment</span></Result>
          <Result show={phase === 2} delay={0.4}><span className="text-muted-foreground">rescue epoch</span><span>0 → 1</span></Result>
        </div>
      </SceneFrame>
    </div>
  );
}

/** Demo Vault: assets per share fall below the floor; a 0-ETH reporter pauses it; the attacker's next step reverts. */
export function VaultScene() {
  const { ref, phase, cycle } = usePhases([2200, 1600, 3200]);
  return (
    <div ref={ref}>
      <SceneFrame label="guarded vault · rule pays">
        <p className="label-mono">assets per share</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <p className={big}>{phase === 0 ? <Tick key={cycle} from={1.0} to={0.88} decimals={3} ms={1900} run={cycle} /> : "0.880"}</p>
          <Pill on={phase > 0}>{phase > 0 ? "invariant broken" : "floor 1.000"}</Pill>
        </div>
        <div className="relative mt-6 h-20">
          <AnimatePresence mode="wait">
            {phase < 2 ? (
              <motion.div key="alarm" exit={{ opacity: 0 }} className="flex h-full flex-wrap items-center gap-3 font-mono text-[12px]">
                <span className="whitespace-nowrap rounded-full border border-[var(--glass-border)] px-3 py-1.5 text-muted-foreground">attacker · step 1</span>
                <span className="text-faint">→</span>
                <motion.span animate={{ opacity: phase === 1 ? 1 : 0.3 }} className="whitespace-nowrap rounded-full border border-foreground/40 px-3 py-1.5">
                  reporter · 0 ETH · triggers
                </motion.span>
              </motion.div>
            ) : (
              <motion.div key="paused" initial={{ opacity: 0, scale: 1.25, filter: "blur(10px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} transition={{ type: "spring", stiffness: 300, damping: 22 }} className="flex h-full items-center">
                <span className="rounded-2xl border-2 border-foreground px-5 py-2 font-pixel text-[40px] leading-none tracking-wider">PAUSED</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="mt-4">
          <Result show={phase === 2}><span className="text-muted-foreground">who paid the gas</span><span>the vault</span></Result>
          <Result show={phase === 2} delay={0.2}><span className="text-muted-foreground">attacker · step 2</span><span>✕ reverts Paused()</span></Result>
          <Result show={phase === 2} delay={0.4}><span className="text-muted-foreground">mempool</span><span>✓ public, own storage only</span></Result>
        </div>
      </SceneFrame>
    </div>
  );
}

const HEX = ["0x1f3a9c04e7b2d815 6a0c33f9e1d27b48", "0x0b77e2a91c4d5f60 93ae1b2c7d08f4e5", "0x2c90d1e3f45a6b78 c1d2e3f4a5b6c7d8", "0x13a5c7e9f0b2d4f6 08192a3b4c5d6e7f"];

function HexLine({ text, run }: { text: string; run: number }) {
  return <p className="truncate">{useScramble(text + " ".repeat(run % 2), true, 1400)}</p>;
}

/** Proof-of-Exploit Bounty: a Groth16 proof checked in VERIFY, above the public budget, pays a fresh address. */
export function BountyScene() {
  const { ref, phase, cycle } = usePhases([2200, 1800, 3200]);
  const est = 202_000;
  return (
    <div ref={ref}>
      <SceneFrame label="proof-of-exploit bounty · zero knowledge">
        <p className="label-mono">Groth16 proof · VERIFY data</p>
        <div className="mt-3 space-y-1 font-mono text-[12px] text-muted-foreground sm:text-[13px]">
          {HEX.map((h, i) => (
            <HexLine key={i + "-" + cycle} text={h} run={cycle} />
          ))}
        </div>
        <div className="mt-6 font-mono text-[12px]">
          <div className="mb-2 flex justify-between gap-3 text-muted-foreground">
            <span>verify cost</span>
            <span>{phase >= 1 ? "~202k estimated · 2.5M staked budget" : "checking…"}</span>
          </div>
          <div className="relative h-2 rounded-full bg-foreground/[0.07]">
            <motion.div key={cycle} initial={{ width: 0 }} animate={{ width: phase >= 1 ? `${(est / 250_000) * 100}%` : "0%" }} transition={{ duration: 1.2, ease: [0.2, 0.7, 0.2, 1] }} className="absolute inset-y-0 left-0 rounded-full bg-foreground" />
            <div className="absolute -top-1.5 h-5 w-px bg-foreground/50" style={{ left: "40%" }} />
          </div>
          <div className="mt-1.5 text-faint" style={{ paddingLeft: "calc(40% - 40px)" }}>public 100k</div>
        </div>
        <div className="mt-3">
          <Result show={phase === 2}><span className="text-muted-foreground">proof</span><span>✓ binds vault, state, recipient</span></Result>
          <Result show={phase === 2} delay={0.2}><span className="text-muted-foreground">bounty</span><span>→ fresh address</span></Result>
          <Result show={phase === 2} delay={0.4}><span className="text-muted-foreground">vault</span><span>paused · paid the gas</span></Result>
        </div>
      </SceneFrame>
    </div>
  );
}
