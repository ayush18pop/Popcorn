import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Atom } from "lucide-react";
import { Reveal, Spotlight } from "@/components/motion";
import { GasTag, MempoolBadges, StatusBadge } from "@/components/bits";
import { CORNERS, MODULES, TRIGGER_TEXT, cornerById, moduleById, type Module, type Status, type Trigger } from "@/lib/catalog";
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
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={m.status} />
              {m.postQuantum && (
                <span className="inline-flex items-center gap-1 rounded-full border border-foreground/40 px-2 py-0.5 font-mono text-[10.5px] text-foreground">
                  <Atom className="size-3" /> post-quantum
                </span>
              )}
              {m.properties.includes("private") && <span className="rounded-full border border-foreground/40 px-2 py-0.5 font-mono text-[10.5px] text-foreground">private</span>}
            </div>
            <span className="font-mono text-[11px] text-faint">{m.trigger}</span>
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

// The modules a reader should see first, whatever they filter by: the bounty, the quantum switch and the post-quantum
// signers, the private pool, Core and the open sponsor.
const HIGHLIGHTS: { id: string; kicker: string; title: string; line: string; big?: boolean; href?: string; chips?: string[] }[] = [
  { id: "proof-of-exploit-bounty", kicker: "Protect", title: "Proof-of-Exploit Bounty", line: "A whitehat proves the bug in zero knowledge from a key with no ETH. Paid to a fresh address, and the vault paused, in one transaction. No committee.", big: true },
  { id: "quantum-switch", kicker: "Post-quantum", title: "Quantum Switch", line: "The day ECDSA breaks, owner signatures stop working and only a post-quantum key nobody has seen can move the money." },
  { id: "wots-signer", kicker: "Post-quantum", title: "Post-quantum signers", line: "Hash-based and lattice signatures a quantum computer cannot forge, three of them within the public mempool's budget.", chips: ["wots-signer", "xmss-signer", "sphincs-signer", "fors-signer", "falcon-signer"] },
  { id: "private-pool", kicker: "Private", title: "Private Pool", line: "Withdraw to an address with no ETH, no relayer and no link to the deposit. The pool pays the gas; association sets keep flagged funds out." },
  { id: "core", kicker: "Core", title: "Popcorn Core", line: "The account code every rule contract runs: one frame layout, fee caps, once per event, a re-entry lock. Anyone can trigger; a false condition costs nothing.", href: "#/docs/contracts" },
  { id: "open-sponsor", kicker: "Gas", title: "Open Sponsor", line: "Gas sponsorship as public code, not a server: budgets, a fee cap and an anonymous one-account-per-member gate." },
];

function Highlights() {
  return (
    <section className="mt-10">
      <p className="label-mono mb-4">Start here</p>
      <div className="grid gap-4 md:grid-cols-3">
        {HIGHLIGHTS.map((h, i) => {
          const m = moduleById(h.id);
          const link = h.href ?? (m ? href("modules", m.group, m.id) : "#");
          const gas = m?.gas ? (m.gas.total ?? m.gas.validation) : null;
          return (
            <Reveal key={h.id} delay={i * 0.05} className={cn(h.big && "md:col-span-2 md:row-span-2")}>
              <Spotlight className="glass group relative h-full overflow-hidden rounded-[26px]">
                <a href={link} className={cn("flex h-full flex-col p-6", h.big && "md:p-9")}>
                  <div className="flex items-center justify-between">
                    <span className="label-mono">{h.kicker}</span>
                    <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                  </div>
                  <h3 className={cn("text-chrome mt-4 font-semibold tracking-tight", h.big ? "text-[30px] leading-[1.05] md:text-[44px]" : "text-[19px]")}>{h.title}</h3>
                  <p className={cn("mt-3 leading-relaxed text-muted-foreground", h.big ? "max-w-[520px] text-[15px] md:text-[17px]" : "text-[13px]")}>{h.line}</p>
                  {h.chips && (
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {h.chips.map((c) => {
                        const cm = moduleById(c);
                        return cm ? (
                          <span key={c} onClick={(e) => { e.preventDefault(); window.location.hash = href("modules", cm.group, cm.id).slice(1); }} className="cursor-pointer rounded-full border border-foreground/30 px-2.5 py-1 font-mono text-[11px] text-foreground hover:bg-foreground/[0.06]">
                            {cm.name.replace(/ Signer$/, "")}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-3 pt-5 font-mono text-[11px] text-faint">
                    {gas !== null && gas !== undefined && <span>{gas.toLocaleString("en-US")} gas · {m!.gas!.tag}</span>}
                    {m?.example && <span>recorded example ↗</span>}
                    {h.id === "core" && <span>254 contract tests</span>}
                  </div>
                </a>
              </Spotlight>
            </Reveal>
          );
        })}
      </div>
    </section>
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
              : `${MODULES.length} modules in five use cases. ${built} are built, in the repository with passing tests; the rest are planned. Every page starts from what the module does for you.`}
          </p>
        </Reveal>

        {!active && <Highlights />}

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

        {(active ? [active] : CORNERS).map((g, gi) => {
          const mods = list.filter((m) => m.group === g.id);
          if (mods.length === 0) return null;
          return (
            <section key={g.id} className="mt-12">
              {!active && (
                <div className="mb-5 flex items-baseline justify-between gap-4 border-b border-[var(--glass-border)] pb-3">
                  <h2 className="text-[20px] font-semibold tracking-tight">
                    <span className="mr-3 font-pixel text-[13px] text-faint">0{gi + 1}</span>
                    {g.name}
                  </h2>
                  <a href={href("modules", g.id)} className="text-[12px] text-muted-foreground hover:text-foreground">{g.does}</a>
                </div>
              )}
              <motion.div layout className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {mods.map((m, i) => (
                    <ModuleCard key={m.id} m={m} i={i} />
                  ))}
                </AnimatePresence>
              </motion.div>
            </section>
          );
        })}
        {list.length === 0 && <p className="mt-16 text-center text-[14px] text-muted-foreground">No module matches these filters yet.</p>}

        <p className="mt-12 text-[12px] leading-relaxed text-faint">
          Source: docs/catalog/&lt;corner&gt;/&lt;module&gt;.md. Hover a card for the mempool reason. Gas is tagged measured only with the network it was measured on.
        </p>
      </div>
    </div>
  );
}
