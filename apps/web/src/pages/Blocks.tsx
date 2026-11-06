import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Reveal, Spotlight } from "@/components/motion";
import { MempoolBadges, StatusBadge } from "@/components/bits";
import { BLOCKS, READY_MADE, SHAPES, SIGNERS, TIERS, blockById, projectsUsing, shapeLabel, type Block, type ShapeId } from "@/lib/catalog";
import { href } from "@/lib/route";
import { cn } from "@/lib/utils";

const plain = (s: string) => s.replace(/`/g, "");

export function BlockCard({ m, i = 0 }: { m: Block; i?: number }) {
  const used = projectsUsing(m.id).length;
  return (
    <motion.div layout initial={{ opacity: 0, y: 16, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.35, delay: Math.min(i, 8) * 0.03 }}>
      <Spotlight className={cn("glass group relative h-full overflow-hidden rounded-[24px]", m.status !== "built" && "opacity-80")}>
        <a href={href("blocks", m.id)} className="flex h-full min-h-[220px] flex-col p-6 transition-transform duration-500 ease-[cubic-bezier(.2,.7,.2,1)] group-hover:-translate-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="label-mono">{shapeLabel(m)}</span>
            <span className="flex items-center gap-1.5">
              {m.postQuantum && <span className="rounded-full border border-foreground/40 px-2 py-0.5 font-mono text-[10px] text-foreground">post-quantum</span>}
              {m.status !== "built" && <StatusBadge status={m.status} />}
            </span>
          </div>
          <h3 className="mt-4 text-[17px] font-semibold tracking-tight">{m.name}</h3>
          <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">{plain(m.summary)}</p>
          {m.inputs.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1">
              {m.inputs.map((x) => (
                <span key={x.name} title={x.what} className="rounded-md border border-[var(--glass-border)] bg-foreground/[0.03] px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                  {x.name}
                </span>
              ))}
            </div>
          )}
          <div className="mt-auto space-y-3 pt-5">
            <MempoolBadges m={m} />
            <div className="flex items-center justify-between border-t border-[var(--glass-border)] pt-3">
              <span className="font-mono text-[11px] text-faint">
                {m.gas?.validation ? `${m.gas.validation.toLocaleString("en-US")} gas · ${m.gas.tag}` : used ? `used in ${used} example${used === 1 ? "" : "s"}` : "not in an example yet"}
              </span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
            </div>
          </div>
        </a>
      </Spotlight>
    </motion.div>
  );
}

/** Older name, for pages that still import it. */
export const ModuleCard = BlockCard;

function Grid({ list }: { list: Block[] }) {
  return (
    <motion.div layout className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <AnimatePresence mode="popLayout">
        {list.map((m, i) => (
          <BlockCard key={m.id} m={m} i={i} />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

export default function Blocks() {
  const [shape, setShape] = useState<ShapeId | null>(null);
  const list = useMemo(() => BLOCKS.filter((m) => !shape || m.shape === shape), [shape]);
  const active = SHAPES.find((s) => s.id === shape);
  const filters: { id: ShapeId | null; label: string }[] = [{ id: null, label: "All" }, ...SHAPES.map((s) => ({ id: s.id, label: s.plural }))];

  return (
    <div className="relative overflow-x-clip px-4 pb-32 pt-36 sm:px-6">
      <div className="mx-auto max-w-[1120px]">
        <Reveal>
          <p className="label-mono mb-4">Blocks</p>
          <h1 className="text-chrome max-w-[860px] text-[42px] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[64px]">Blocks</h1>
          <p className="mt-5 max-w-[640px] text-[16px] leading-relaxed text-muted-foreground">
            Every build is a gas payer, conditions combined with logic operators, and actions. Pick blocks, plug them together: in Solidity by inheriting them, or with no Solidity through the SDK's{" "}
            <code className="font-mono text-[0.9em] text-foreground">blocks</code> functions.
          </p>
        </Reveal>

        <Highlights />

        {/* shapes */}
        <Reveal delay={0.08} className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SHAPES.map((s) => (
            <div key={s.id} className="rounded-2xl border border-[var(--glass-border)] px-4 py-3">
              <p className="label-mono">{s.name}</p>
              <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{s.does}</p>
            </div>
          ))}
        </Reveal>

        {/* shape filter */}
        <Reveal delay={0.12} className="mt-8 border-y border-[var(--glass-border)] py-4">
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
            {filters.map((f) => (
              <button key={f.label} onClick={() => setShape(f.id)} className={cn("relative shrink-0 rounded-full px-4 py-2 text-[13px]", shape === f.id ? "text-background" : "text-muted-foreground hover:text-foreground")}>
                {shape === f.id && <motion.span layoutId="shape" className="absolute inset-0 rounded-full bg-foreground" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <span className="relative">{f.label}</span>
              </button>
            ))}
          </div>
          {active && <p className="mt-3 text-[13px] text-muted-foreground">{active.does}</p>}
        </Reveal>

        {TIERS.map((t) => {
          const mods = list.filter((m) => m.tier === t.id);
          if (mods.length === 0) return null;
          return (
            <section key={t.id} className="mt-12">
              <div className="mb-5 flex items-baseline justify-between gap-4 border-b border-[var(--glass-border)] pb-3">
                <h2 className="text-[20px] font-semibold tracking-tight">
                  {t.title}
                  <span className="mt-1 block text-[13px] font-normal text-muted-foreground">{t.sub}</span>
                </h2>
                <span className="font-mono text-[11px] text-faint">{mods.length}</span>
              </div>
              <Grid list={mods} />
            </section>
          );
        })}
        {list.length === 0 && <p className="mt-16 text-center text-[14px] text-muted-foreground">No block of this kind yet.</p>}

        {(!shape || shape === "signer") && SIGNERS.length > 0 && (
          <section className="mt-20">
            <div className="mb-5 border-b border-[var(--glass-border)] pb-3">
              <h2 className="text-[20px] font-semibold tracking-tight">Signers</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">The Signature condition's key types. Each post-quantum scheme by name, with its measured validation gas: WOTS+, XMSS and FORS fit the public mempool's 100,000.</p>
            </div>
            <Grid list={SIGNERS} />
          </section>
        )}

        {READY_MADE.length > 0 && (
          <section className="mt-20">
            <div className="mb-5 border-b border-[var(--glass-border)] pb-3">
              <h2 className="text-[20px] font-semibold tracking-tight">Complete contracts</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">Whole applications you can deploy as they are, or fork.</p>
            </div>
            <Grid list={READY_MADE} />
          </section>
        )}

        <p className="mt-12 text-[12px] leading-relaxed text-faint">Source: docs/catalog/&lt;conditions|operators|actions|payers|complete&gt;/&lt;block&gt;.md. Hover a mempool chip for the reason.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- start here */

// What a reader should see first, whatever they filter by: the bounty, post-quantum, privacy, Core and the paymaster.
const HIGHLIGHTS: { id?: string; href?: string; kicker: string; title: string; line: string; big?: boolean; chips?: string[] }[] = [
  { href: "#/examples/protect/proof-of-exploit", kicker: "Example", title: "Proof-of-Exploit Bounty", line: "A whitehat proves the bug in zero knowledge from a key with no ETH. Paid to a fresh address, and the vault paused, in one transaction. No committee.", big: true },
  { id: "post-quantum-mode", kicker: "Post-quantum", title: "Post-Quantum Mode", line: "The day ECDSA breaks, owner signatures stop working and only a post-quantum key nobody has seen can move the money." },
  { id: "wots", kicker: "Post-quantum", title: "Post-quantum signers", line: "Hash-based and lattice signatures a quantum computer cannot forge, three of them within the public mempool's budget.", chips: ["wots", "xmss", "fors", "sphincs", "falcon"] },
  { id: "privacy-pool", kicker: "Private", title: "Privacy Pool", line: "Withdraw to an address with no ETH, no relayer and no link to the deposit. The pool pays the gas; association sets keep flagged funds out." },
  { href: "#/docs/contracts", kicker: "Core", title: "Popcorn Core", line: "The account code every build runs on: one frame layout, fee caps, once per event, a re-entry lock. Anyone can trigger; a NO costs nothing." },
  { id: "paymaster", kicker: "Gas", title: "Paymaster", line: "Gas sponsorship as public code, not a server: budgets, a fee cap and an anonymous one-account-per-member gate." },
];

function Highlights() {
  return (
    <section className="mt-10">
      <p className="label-mono mb-4">Start here</p>
      <div className="grid gap-4 md:grid-cols-3">
        {HIGHLIGHTS.map((h, i) => {
          const m = h.id ? blockById(h.id) : undefined;
          const link = h.href ?? (m ? href("blocks", m.id) : "#");
          const gas = m?.gas ? (m.gas.total ?? m.gas.validation) : null;
          return (
            <Reveal key={h.title} delay={i * 0.05} className={cn(h.big && "md:col-span-2 md:row-span-2")}>
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
                        const cm = blockById(c);
                        return cm ? (
                          <span
                            key={c}
                            onClick={(e) => {
                              e.preventDefault();
                              window.location.hash = href("blocks", cm.id).slice(1);
                            }}
                            className="cursor-pointer rounded-full border border-foreground/30 px-2.5 py-1 font-mono text-[11px] text-foreground hover:bg-foreground/[0.06]"
                          >
                            {cm.name.replace(/ Signer$/, "")}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-3 pt-5 font-mono text-[11px] text-faint">
                    {gas !== null && gas !== undefined && m?.gas && <span>{gas.toLocaleString("en-US")} gas · {m.gas.tag}</span>}
                    {h.big && <span>recorded example ↗</span>}
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
