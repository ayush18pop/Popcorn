import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Reveal, Spotlight } from "@/components/motion";
import { Code, StatusBadge } from "@/components/bits";
import { BLOCKS, SHAPES, type ShapeId } from "@/lib/catalog";
import { href } from "@/lib/route";
import { cn } from "@/lib/utils";

// The agent skills live in the repo at .claude/skills/ (popcorn-build, popcorn-debug) as plain SKILL.md files: any agent
// that reads skill folders can use them, together with the read-only MCP server (hosted, or from .mcp.json).

const MCP_URL = "https://popcorn-mcp.vercel.app/mcp";
const INSTALL_STEPS: { title: string; note: string; cmd: string }[] = [
  { title: "1 · Get the skills", note: "Plain SKILL.md files. Put them where your agent reads skills (for example .claude/skills, or your agent's skills folder).", cmd: "npx degit ayush18pop/Popcorn/.claude/skills skills" },
  { title: "2 · Connect the MCP server", note: "Hosted, read-only, Streamable HTTP. Add this to any MCP client's config.", cmd: `{ "mcpServers": { "popcorn": { "url": "${MCP_URL}" } } }` },
  { title: "3 · Ask", note: "Describe the problem in plain words; the skill picks the blocks, builds and runs it.", cmd: "Pause our vault the moment assets per share fall below 1.0, with no Solidity." },
];

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="group flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--glass-border)] bg-background/60 px-3 py-2.5 text-left font-mono text-[12px] text-foreground/90 hover:border-foreground/30"
      title="Copy"
    >
      <span className="min-w-0 truncate">{text}</span>
      <span className="shrink-0 text-[10.5px] text-faint group-hover:text-foreground">{done ? "copied" : "copy"}</span>
    </button>
  );
}

const SKILLS: { id: string; groups: ShapeId[]; does: string; tools: string[] }[] = [
  { id: "popcorn-build", groups: ["check", "join", "action", "payer"], does: "Turns a problem (“pay salaries privately”, “free transactions for our members”) into blocks, starts from the closest example project, deploys it on the local devnet and runs it.", tools: ["list_examples", "how_to_build", "get_block", "can_trigger", "build_trigger"] },
  { id: "popcorn-debug", groups: ["check", "payer"], does: "Explains why a trigger was refused: which frame said no, the code in plain words, who paid (usually nobody) and the one change that fixes it.", tools: ["can_trigger", "explain_code", "rule_contract_info"] },
];

const CONVO = [
  { who: "you", text: "Our community wants free transactions for members, without a paymaster server that can cut people off." },
  { who: "agent", text: "That is the Open Gas Network example: a Paymaster whose policy is public code, Membership Proof so each member admits one account without saying who, and an app account that lets the sponsor pay. I'll run it on your local devnet." },
  { who: "agent", text: "can_trigger: ready. Sent from a key with no ETH and included; the sponsor paid, 839,535 gas. A second account from the same member is refused by the sponsor with 0x6d: nullifier already used." },
];

const RULE = `# .claude/skills/popcorn-build/SKILL.md
name: popcorn-build
description: Build something with Popcorn: turn a problem into a build
  made of blocks, start from the closest example project, deploy it to the
  local devnet and run it.

# the commands it runs
bun packages/sdk/scripts/record-examples.ts open-gas-network
bun test packages/mcp/test/        # the MCP tools it calls`;

export default function Skills() {
  const [sel, setSel] = useState(SKILLS[0].id);
  const skill = SKILLS.find((s) => s.id === sel)!;
  const pages = BLOCKS.filter((m) => skill.groups.includes(m.shape as ShapeId) && m.status === "built").slice(0, 12);

  return (
    <div className="relative overflow-x-clip">
      <AuroraBackground className="h-[760px] bg-transparent">
        <div className="relative z-10 mx-auto w-full max-w-[1120px] px-4 pt-24 sm:px-6">
          <Reveal>
            <p className="label-mono mb-4">Agent skills</p>
            <h1 className="text-chrome max-w-[860px] text-[42px] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[64px]">Describe the problem. Get a running project.</h1>
            <div className="mt-6 grid max-w-[760px] gap-3">
              {INSTALL_STEPS.map((s) => (
                <div key={s.title}>
                  <p className="mb-1 text-[12.5px] text-muted-foreground">
                    <span className="font-medium text-foreground">{s.title}</span> · {s.note}
                  </p>
                  <CopyLine text={s.cmd} />
                </div>
              ))}
            </div>
            <p className="mt-4 max-w-[640px] text-[13px] leading-relaxed text-muted-foreground">
              Works with any agent that reads skills and speaks MCP (Claude Code, Codex, Gemini CLI, OpenCode and others). Two skills: one builds from a problem, one explains a refusal. Or clone the repository: the skills and the MCP config are already in it.
            </p>
          </Reveal>
        </div>
      </AuroraBackground>

      <div className="mx-auto max-w-[1120px] px-4 pb-32 sm:px-6">
        {/* map: skills → block shapes */}
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
              {SKILLS.flatMap((s, i) =>
                s.groups.map((g) => {
                  const j = SHAPES.findIndex((c) => c.id === g);
                  const on = s.id === sel;
                  return (
                    <motion.path
                      key={s.id + g}
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
                }),
              )}
            </svg>
            <div className="space-y-1.5">
              {SHAPES.map((c) => (
                <a key={c.id} href={href("blocks")} className={cn("block rounded-xl px-3 py-2 text-[12px] transition-colors sm:text-[13px]", skill.groups.includes(c.id) ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                  {c.plural}
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
                <StatusBadge status="built" />
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
                  <a key={m.id} href={href("blocks", m.id)} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground">
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
              <h2 className="text-chrome text-[30px] font-semibold tracking-[-0.03em]">From one sentence to a running project.</h2>
            </Reveal>
            <div className="mt-8 space-y-4">
              {CONVO.map((c, i) => (
                <Reveal key={i} delay={i * 0.15}>
                  <div className={cn("flex gap-3", c.who === "you" && "flex-row-reverse text-right")}>
                    <Avatar className="size-8 border border-[var(--glass-border)]">
                      <AvatarFallback className="bg-foreground/[0.06] font-mono text-[10px]">{c.who === "you" ? "you" : "AI"}</AvatarFallback>
                    </Avatar>
                    <Spotlight className={cn("glass max-w-[440px] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed", c.who === "you" ? "text-foreground" : "text-foreground/85")}>{c.text}</Spotlight>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
          <Reveal delay={0.3}>
            <Code files={[{ filename: "popcorn-build", lang: "text", code: RULE }]} />
            <p className="mt-3 text-[12px] text-faint">The numbers in the conversation are from the Open Gas Network run recorded on the local devnet.</p>
          </Reveal>
        </section>
      </div>
    </div>
  );
}
