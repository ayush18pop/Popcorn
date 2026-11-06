import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Reveal, Spotlight } from "@/components/motion";
import { Code, StatusBadge } from "@/components/bits";
import { CORNERS, MODULES, type CornerId } from "@/lib/catalog";
import { href } from "@/lib/route";
import { cn } from "@/lib/utils";

// The Claude skills are planned (journal decision 41; docs/ui-handoff.md "Skills page"). This page shows what each
// one is for and which catalog pages it reads. It does not claim any of them can be installed yet.

const SKILLS: { id: string; corner: CornerId; does: string; tools: string[] }[] = [
  { id: "popcorn-pause", corner: "protect", does: "Turns “pause my protocol if …” into a pause rule for your contracts.", tools: ["list_modules", "plan_rule", "check_rule"] },
  { id: "popcorn-protect", corner: "protect", does: "Protects a lending position before liquidation: repay or top up.", tools: ["get_module", "plan_rule", "check_rule"] },
  { id: "popcorn-exit", corner: "protect", does: "Gets funds out of a venue when its market or accounting breaks.", tools: ["get_module", "plan_rule", "check_rule"] },
  { id: "popcorn-payout", corner: "prove", does: "Sets up bounties and rewards that only the payer or a proof can claim.", tools: ["get_module", "plan_rule"] },
  { id: "popcorn-liquidate", corner: "protect", does: "Designs liquidations with one winner per event.", tools: ["get_module", "plan_rule"] },
  { id: "popcorn-gas", corner: "gas", does: "Chooses rule-pays or caller-pays and sizes the fee caps.", tools: ["get_module", "check_rule"] },
  { id: "popcorn-sign", corner: "sign", does: "Picks a signer, including post-quantum ones, and wires the intent.", tools: ["get_module", "plan_rule"] },
  { id: "popcorn-debug", corner: "prove", does: "Explains why a trigger was refused, rule by rule, and the fix.", tools: ["explain_rule", "rule_status", "decode_frame_tx", "admission_report"] },
];

const CONVO = [
  { who: "you", text: "Protect my vault: pause it if assets per share drop 20% below par." },
  { who: "claude", text: "That is the share-price invariant, read from your vault's own storage, so it fits the public mempool with no stake. I'll start from the Guarded Vault pause profile with a floor of 0.8." },
  { who: "claude", text: "check_rule: ✓ public EIP-8141 · ✓ alternative, unstaked. The trigger is free for the reporter; the vault pays." },
];

const RULE = `# vault-floor.rule.yaml (illustration of a planned skill's output)
module: guarded-vault
corner: pause
condition: totalAssets * 1e18 < totalSupply * 0.8e18
action: pause
payer: rule-pays
reward: { to: payer, from: reward pool }`;

export default function Skills() {
  const [sel, setSel] = useState(SKILLS[0].id);
  const skill = SKILLS.find((s) => s.id === sel)!;
  const pages = MODULES.filter((m) => m.corner === skill.corner);

  return (
    <div className="relative overflow-x-clip">
      <AuroraBackground className="h-[560px] bg-transparent">
        <div className="relative z-10 mx-auto w-full max-w-[1120px] px-4 pt-24 sm:px-6">
          <Reveal>
            <p className="label-mono mb-4">Claude skills · planned</p>
            <h1 className="text-chrome max-w-[860px] text-[42px] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[64px]">Describe the protection. Get the rule.</h1>
            <p className="mt-5 max-w-[580px] text-[16px] leading-relaxed text-muted-foreground">
              One skill per corner of the catalog. Each reads the module pages and the SDK reference, plans a rule file and checks which mempool admits it. They are planned; this page shows the design.
            </p>
          </Reveal>
        </div>
      </AuroraBackground>

      <div className="mx-auto max-w-[1120px] px-4 pb-32 sm:px-6">
        {/* map: skills → corners */}
        <Reveal>
          <div className="glass relative grid grid-cols-[1fr_auto_1fr] items-stretch gap-0 rounded-[28px] p-4 sm:p-6">
            <div className="space-y-1.5">
              {SKILLS.map((s) => (
                <button key={s.id} onClick={() => setSel(s.id)} className={cn("relative block w-full rounded-xl px-3 py-2 text-left font-mono text-[11.5px] transition-colors sm:text-[12.5px]", sel === s.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {sel === s.id && <motion.span layoutId="skill-sel" className="absolute inset-0 rounded-xl border border-[var(--glass-border)] bg-foreground/[0.06]" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                  <span className="relative">{s.id}</span>
                </button>
              ))}
            </div>
            <svg className="w-10 sm:w-24" viewBox="0 0 100 320" preserveAspectRatio="none" aria-hidden>
              {SKILLS.map((s, i) => {
                const j = CORNERS.findIndex((c) => c.id === s.corner);
                const on = s.id === sel;
                return (
                  <motion.path
                    key={s.id}
                    d={`M0 ${20 + i * 40} C 50 ${20 + i * 40}, 50 ${20 + j * 40}, 100 ${20 + j * 40}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={on ? 1.5 : 0.6}
                    className={on ? "text-foreground" : "text-foreground/15"}
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.9, delay: i * 0.05 }}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
            <div className="space-y-1.5">
              {CORNERS.map((c) => (
                <a key={c.id} href={href("modules", c.id)} className={cn("block rounded-xl px-3 py-2 text-[12px] transition-colors sm:text-[13px]", c.id === skill.corner ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                  {c.name}
                </a>
              ))}
            </div>
          </div>
        </Reveal>

        {/* selected skill */}
        <AnimatePresence mode="wait">
          <motion.div key={sel} initial={{ opacity: 0, y: 10, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0 }} className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr]">
            <div className="glass rounded-[24px] p-6">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[14px]">{skill.id}</p>
                <StatusBadge status="planned" />
              </div>
              <p className="mt-4 text-[15px] leading-relaxed text-foreground/85">{skill.does}</p>
              <p className="label-mono mt-6">Methods (MCP tools it calls)</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {skill.tools.map((t) => (
                  <a key={t} href={href("mcp")} className="rounded-full border border-[var(--glass-border)] px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground">
                    {t}
                  </a>
                ))}
              </div>
            </div>
            <div className="glass rounded-[24px] p-6">
              <p className="label-mono">Reads these catalog pages</p>
              <div className="mt-3 space-y-1">
                {pages.map((m) => (
                  <a key={m.id} href={href("modules", m.corner, m.id)} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground">
                    <span>{m.name}</span>
                    <span className="font-mono text-[10.5px] text-faint">{m.status}</span>
                  </a>
                ))}
              </div>
              <p className="mt-3 font-mono text-[11px] text-faint">+ packages/sdk/README.md</p>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* sample conversation */}
        <section className="mt-20 grid items-start gap-6 md:grid-cols-2">
          <div>
            <Reveal>
              <p className="label-mono mb-3">A sample conversation</p>
              <h2 className="text-chrome text-[30px] font-semibold tracking-[-0.03em]">From one sentence to a checked rule.</h2>
            </Reveal>
            <div className="mt-8 space-y-4">
              {CONVO.map((c, i) => (
                <Reveal key={i} delay={i * 0.15}>
                  <div className={cn("flex gap-3", c.who === "you" && "flex-row-reverse text-right")}>
                    <Avatar className="size-8 border border-[var(--glass-border)]">
                      <AvatarFallback className="bg-foreground/[0.06] font-mono text-[10px]">{c.who === "you" ? "you" : "C"}</AvatarFallback>
                    </Avatar>
                    <Spotlight className={cn("glass max-w-[440px] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed", c.who === "you" ? "text-foreground" : "text-foreground/85")}>{c.text}</Spotlight>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
          <Reveal delay={0.3}>
            <Code files={[{ filename: "vault-floor.rule.yaml", lang: "text", code: RULE }]} />
            <p className="mt-3 text-[12px] text-faint">Illustration of the planned output format; the rule-file schema is not final.</p>
          </Reveal>
        </section>
      </div>
    </div>
  );
}
