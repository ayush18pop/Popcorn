import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { coreRule } from "@popcorn/simulator";
import { useScramble } from "@/lib/useScramble";
import { cn } from "@/lib/utils";

// Interactive cards for "the four mistakes". Each one simulates a single rule in the browser, with the rejection text
// taken from the simulator's rule table, and says so.

/** Drag the health factor below 1.1 and the shield's condition becomes true. */
export function HealthCard() {
  const [hf, setHf] = useState(1.32);
  const [sent, setSent] = useState(false);
  const ready = hf < 1.1;
  const pct = ((1.1 - 0.9) / 0.6) * 100;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-mono">Condition · health factor</p>
          <p className="mt-3 font-pixel text-[56px] leading-none tabular-nums md:text-[64px]">{hf.toFixed(2)}</p>
        </div>
        <span className={cn("mb-1 flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[12px] transition-colors", ready ? "border-foreground/40 text-foreground" : "border-[var(--glass-border)] text-muted-foreground")}>
          <span className={cn("size-1.5 rounded-full", ready ? "bg-foreground shadow-[0_0_8px_color-mix(in_srgb,var(--foreground)_70%,transparent)]" : "bg-foreground/25")} />
          {sent ? "✓ triggered" : ready ? "READY" : "CONDITION_FALSE · 0x22"}
        </span>
      </div>

      <div className="relative mt-8">
        <input
          type="range"
          min={0.9}
          max={1.5}
          step={0.01}
          value={hf}
          onChange={(e) => (setHf(Number(e.target.value)), setSent(false))}
          aria-label="Health factor"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-foreground/10 accent-foreground"
        />
        <div className="pointer-events-none absolute -top-2 h-5 w-px bg-foreground/50" style={{ left: `${pct}%` }} />
        <div className="mt-3 flex justify-between font-mono text-[11px] text-faint">
          <span>0.90</span>
          <span>1.10 threshold</span>
          <span>1.50</span>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-4 pt-8">
        <p className="max-w-[360px] text-[13px] leading-relaxed text-muted-foreground">
          {sent
            ? "A quarter of the debt repaid; the payer earned 0.5%. Simulated here, no chain."
            : ready
              ? "Anyone can send the trigger now. No key signs it; the condition does."
              : "Drag it below 1.1. Until then the trigger is invalid, so sending it costs nothing."}
        </p>
        <button disabled={!ready || sent} onClick={() => setSent(true)} className="btn-solid h-10 shrink-0 rounded-full bg-foreground px-5 text-[13px] font-medium text-background disabled:pointer-events-none disabled:opacity-25 disabled:shadow-none">
          {sent ? "Triggered" : "Trigger"}
        </button>
      </div>
    </div>
  );
}

const LAYOUT = [
  ["VERIFY", "rule contract checks its condition"],
  ["SENDER", "rule contract runs its action"],
] as const;

/** Add an extra frame and watch Core refuse it, with the simulator's own words for the error. */
export function LayoutCard() {
  const [extra, setExtra] = useState(false);
  const rule = coreRule(0x05);
  const why = useScramble(extra ? `${rule?.title ?? "refused"} · Core 0x05` : "exactly the layout Core accepts", true, 600);
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2">
        {LAYOUT.map(([m, d]) => (
          <div key={m} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--glass-border)] bg-foreground/[0.03] px-4 py-3">
            <span className="font-mono text-[11px] text-foreground">{m}</span>
            <span className="text-right text-[12px] text-muted-foreground">{d}</span>
          </div>
        ))}
        <AnimatePresence>
          {extra && (
            <motion.div
              initial={{ opacity: 0, height: 0, filter: "blur(6px)" }}
              animate={{ opacity: 1, height: "auto", filter: "blur(0px)", x: [0, -6, 6, -3, 3, 0] }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.5 }}
              className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-foreground/40 px-4 py-3"
            >
              <span className="font-mono text-[11px] text-muted-foreground line-through">DEFAULT</span>
              <span className="text-right text-[12px] text-muted-foreground">a stranger's work, paid by you</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <p className="mt-4 font-mono text-[12px] text-foreground">{extra ? "✕ " : "✓ "}{why}</p>
      <div className="mt-auto flex items-end justify-between gap-4 pt-6">
        <div>
          <h3 className="text-[17px] font-semibold tracking-tight">One exact layout.</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">Core refuses anything else, so nobody can attach work for your contract to pay for.</p>
        </div>
        <button onClick={() => setExtra((x) => !x)} className="shrink-0 rounded-full border border-[var(--glass-border)] px-3.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground">
          {extra ? "Remove it" : "Attach a frame"}
        </button>
      </div>
    </div>
  );
}

/** Who pays: rule-pays or caller-pays, and what the sender needs either way. */
export function PayerCard() {
  const [mode, setMode] = useState<"rule" | "caller">("rule");
  return (
    <div className="flex h-full flex-col">
      <div className="flex rounded-full border border-[var(--glass-border)] p-1 text-[12px]">
        {(["rule", "caller"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className="relative flex-1 rounded-full px-3 py-1.5">
            {mode === m && <motion.span layoutId="payer-pill" className="absolute inset-0 rounded-full bg-foreground" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <span className={cn("relative", mode === m ? "text-background" : "text-muted-foreground")}>{m}-pays</span>
          </button>
        ))}
      </div>
      <p className="label-mono mt-6">Sender needs</p>
      <AnimatePresence mode="wait">
        <motion.div key={mode} initial={{ opacity: 0, y: 8, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
          <p className="numeral-sheen mt-3 font-pixel text-[52px] leading-none">{mode === "rule" ? "0.000" : "gas"}</p>
          <p className="mt-1 font-mono text-[13px] text-muted-foreground">{mode === "rule" ? "ETH · the rule contract pays" : "and earns the reward"}</p>
        </motion.div>
      </AnimatePresence>
      <h3 className="mt-auto pt-8 text-[17px] font-semibold tracking-tight">No drained paymaster.</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        Fee caps fixed at deployment. In caller-pays the reward goes to whoever actually paid, read from the payer's own frame.
      </p>
    </div>
  );
}

/** The simulator's verdict for a condition that reads another contract. */
export function VerdictCard() {
  const [staked, setStaked] = useState(false);
  const a = useScramble(staked ? "rule contract staked · admitted" : "unstaked sender accessed another contract's slot", true, 700);
  return (
    <div className="flex h-full flex-col">
      <p className="label-mono">simulate()</p>
      <h3 className="mt-3 text-[17px] font-semibold tracking-tight">Know which mempool admits it, and why.</h3>
      <div className="mt-6 space-y-2 font-mono text-[12px]">
        <div className="rounded-2xl border border-[var(--glass-border)] bg-foreground/[0.03] px-4 py-3">
          <p className="text-foreground">✕ public EIP-8141 refuses</p>
          <p className="mt-1 text-muted-foreground">the condition reads another contract's storage</p>
        </div>
        <div className={cn("rounded-2xl border px-4 py-3 transition-colors", staked ? "border-foreground/30 bg-foreground/[0.05]" : "border-[var(--glass-border)]")}>
          <p className="text-foreground">{staked ? "✓ alternative ERC-8421 admits" : "✕ alternative ERC-8421 refuses"}</p>
          <p className="mt-1 text-muted-foreground">{a}</p>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 pt-6">
        <p className="text-[12px] text-faint">Sends nothing unless you opt in.</p>
        <button onClick={() => setStaked((s) => !s)} className="btn-solid shrink-0 rounded-full bg-foreground px-3.5 py-1.5 text-[12px] font-medium text-background">
          {staked ? "Unstake" : "Stake it"}
        </button>
      </div>
    </div>
  );
}
