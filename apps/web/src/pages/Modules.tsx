import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Atom } from "lucide-react";
import { Reveal, Spotlight } from "@/components/motion";
import { GasTag, MempoolBadges, StatusBadge } from "@/components/bits";
import { CORNERS, MODULES, TRIGGER_TEXT, cornerById, type Module, type Status, type Trigger } from "@/lib/catalog";
import { href } from "@/lib/route";
import { cn } from "@/lib/utils";

const TRIGGERS = Object.keys(TRIGGER_TEXT) as Trigger[];

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button onClick={onClick} title={title} className={cn("relative rounded-full border px-3 py-1.5 text-[12px] transition-colors", on ? "border-foreground/40 text-foreground" : "border-[var(--glass-border)] text-muted-foreground hover:text-foreground")}>
      {on && <motion.span layoutId={title ? undefined : "chip"} className="absolute inset-0 rounded-full bg-foreground/[0.07]" />}
      <span className="relative">{children}</span>
    </button>
  );
}

export function ModuleCard({ m, i = 0 }: { m: Module; i?: number }) {
  const link = href("modules", m.corner, m.id);
  return (
    <motion.div layout initial={{ opacity: 0, y: 16, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.35, delay: Math.min(i, 8) * 0.03 }}>
      <Spotlight className={cn("glass group relative h-full overflow-hidden rounded-[24px]", m.status !== "built" && "opacity-80")}>
        <a href={link} className="flex h-full min-h-[220px] flex-col p-6 transition-transform duration-500 ease-[cubic-bezier(.2,.7,.2,1)] group-hover:-translate-y-2">
          <div className="flex items-center justify-between gap-2">
            <StatusBadge status={m.status} />
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-faint">
              {m.postQuantum && <Atom className="size-3.5" aria-label="post-quantum" />}
              {m.trigger}
            </span>
          </div>
          <h3 className="mt-5 text-[17px] font-semibold tracking-tight">{m.name}</h3>
          <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">{m.summary.replace(/`/g, "")}</p>
          <div className="mt-auto space-y-3 pt-5">
            <MempoolBadges m={m} />
            <div className="flex items-center justify-between border-t border-[var(--glass-border)] pt-3">
              <GasTag m={m} />
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
            </div>
          </div>
        </a>
        {/* the mempool reason slides up from under the card on hover */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full border-t border-[var(--glass-border)] bg-background/90 px-6 py-3 font-mono text-[11px] leading-snug text-muted-foreground backdrop-blur-xl transition-transform duration-500 ease-[cubic-bezier(.2,.7,.2,1)] group-hover:translate-y-0">
          {m.sections["Mempool"]}
        </div>
      </Spotlight>
    </motion.div>
  );
}

export default function Modules({ corner }: { corner?: string }) {
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const active = cornerById(corner ?? "");

  const list = useMemo(
    () => MODULES.filter((m) => (!active || m.corner === active.id) && (!trigger || m.trigger === trigger) && (!status || m.status === status)),
    [active, trigger, status],
  );
  const built = MODULES.filter((m) => m.status === "built").length;
  const triggersHere = active ? TRIGGERS.filter((t) => MODULES.some((m) => m.corner === active.id && m.trigger === t)) : TRIGGERS;

  return (
    <div className="relative overflow-x-clip px-4 pb-32 pt-36 sm:px-6">
      <div className="mx-auto max-w-[1120px]">
        <Reveal>
          <p className="label-mono mb-4">Modules</p>
          <h1 className="text-chrome max-w-[860px] text-[42px] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[64px]">
            {active ? active.name : "The catalog."}
          </h1>
          <p className="mt-5 max-w-[600px] text-[16px] leading-relaxed text-muted-foreground">
            {active
              ? `${active.does}. Fires on: ${active.triggers.map((t) => TRIGGER_TEXT[t]).join("; ")}.`
              : `${MODULES.length} modules in eight corners. ${built} are built, in the repository with passing tests; the rest are planned. Every page starts from what the module does for your protocol.`}
          </p>
        </Reveal>

        {/* corners */}
        <Reveal delay={0.1} className="mt-10">
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            <a href={href("modules")} className={cn("relative shrink-0 rounded-full px-4 py-2 text-[13px]", !active ? "text-background" : "text-muted-foreground hover:text-foreground")}>
              {!active && <motion.span layoutId="corner" className="absolute inset-0 rounded-full bg-foreground" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span className="relative">All</span>
            </a>
            {CORNERS.map((c) => (
              <a key={c.id} href={href("modules", c.id)} className={cn("relative shrink-0 rounded-full px-4 py-2 text-[13px]", active?.id === c.id ? "text-background" : "text-muted-foreground hover:text-foreground")}>
                {active?.id === c.id && <motion.span layoutId="corner" className="absolute inset-0 rounded-full bg-foreground" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <span className="relative">{c.name}</span>
              </a>
            ))}
          </div>
        </Reveal>

        {/* filters */}
        <Reveal delay={0.15} className="mt-6 flex flex-col gap-3 border-y border-[var(--glass-border)] py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label-mono mr-2">Trigger</span>
            {triggersHere.map((t) => (
              <Chip key={t} on={trigger === t} onClick={() => setTrigger(trigger === t ? null : t)} title={TRIGGER_TEXT[t]}>
                {t}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label-mono mr-2">Status</span>
            {(["built", "planned"] as Status[]).map((s) => (
              <Chip key={s} on={status === s} onClick={() => setStatus(status === s ? null : s)} title={s}>
                {s}
              </Chip>
            ))}
          </div>
        </Reveal>

        <motion.div layout className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {list.map((m, i) => (
              <ModuleCard key={m.id} m={m} i={i} />
            ))}
          </AnimatePresence>
        </motion.div>
        {list.length === 0 && <p className="mt-16 text-center text-[14px] text-muted-foreground">No module matches these filters yet.</p>}

        <p className="mt-12 text-[12px] leading-relaxed text-faint">
          Source: docs/catalog/&lt;corner&gt;/&lt;module&gt;.md. Hover a card for the mempool reason. Gas is tagged measured only with the network it was measured on.
        </p>
      </div>
    </div>
  );
}
