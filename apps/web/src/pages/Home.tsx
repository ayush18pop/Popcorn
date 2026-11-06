import { useState } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { MeshGradient } from "@paper-design/shaders-react";
import { Snippet, SnippetCopyButton, SnippetHeader, SnippetTabsContent, SnippetTabsList, SnippetTabsTrigger } from "@/components/kibo-ui/snippet";
import { MetalPopcorn } from "@/components/MetalPopcorn";
import { TiltOnScroll } from "@/components/TiltOnScroll";
import { CountUp, Reveal, Spotlight } from "@/components/motion";
import { Peel } from "@/components/effects/Peel";
import { Code, GhostLink, PrimaryLink, SectionHead, StatusBadge, TAB } from "@/components/bits";
import { HealthCard, LayoutCard, PayerCard, VerdictCard } from "@/components/cards";
import { Player } from "@/player/Player";
import { CORNERS, MODULES, REPO } from "@/lib/catalog";
import { RUNS } from "@/lib/runs";
import { href } from "@/lib/route";
import { cn } from "@/lib/utils";

const QUICK = [
  { id: "clone", label: "clone", cmd: "git clone https://github.com/ayush18pop/Popcorn.git && cd Popcorn && bun install" },
  { id: "build", label: "build", cmd: "bash contracts/core/build.sh && (cd contracts && forge build && forge test)" },
  { id: "devnet", label: "devnet", cmd: "devnet/up.sh && POPCORN_DEVNET=local bun packages/sdk/examples/01-rule-pays.ts" },
];

const loop = [
  {
    language: "ts",
    filename: "01-rule-pays.ts",
    code: `const deployer = createWalletClient({ account, chain, transport: http() })
  .extend(popcorn({ devnet }));
const { ruleContract } = await deployer.deployRule({
  logic: { bytecode: counter.bytecode },
  fund: parseEther("0.01"),
});

// a client with no account and no ETH
const anyone = createPublicClient({ chain, transport: http() })
  .extend(popcorn({ devnet }));
const before = await anyone.canTrigger(ruleContract);
console.log(before.name); // CONDITION_FALSE (Core 0x22)

const hash = await anyone.trigger(ruleContract);
const status = await anyone.watch(hash);`,
  },
  {
    language: "sh",
    filename: "simulate",
    code: `bun packages/sdk/bin/popcorn-simulate.ts <rule contract> --devnet local
# each mempool's verdict, the rule that blocks it and the fix.
# sends nothing unless you pass --sidecar-admit`,
  },
];

const stats = [
  { v: 0, s: "", label: "ETH needed to trigger", sub: "in rule-pays mode" },
  { v: 101, s: "", label: "bytes of settings", sub: "immutable, appended to Core" },
  { v: 252, s: "", label: "contract tests", sub: "forge test" },
  { v: 5, s: "", label: "projects recorded on a devnet", sub: "every transaction real" },
];

const featured = [
  { key: "private/private-payroll", n: "01", t: "Private Payroll", d: "Salaries to ML-KEM stealth addresses, savings in a private pool. No relayer, no gas top-up, no link between addresses.", tag: "private · recorded on devnet" },
  { key: "gas/open-gas-network", n: "02", t: "Open Gas Network", d: "Members get free transactions from a sponsor whose policy is public code. Nobody can switch it off or learn who they are.", tag: "gas · recorded on devnet" },
  { key: "sign/quantum-ready-treasury", n: "03", t: "Quantum-Ready Treasury", d: "Hidden guardians flip a quantum switch; only a post-quantum key nobody has seen can move the money.", tag: "post-quantum · recorded on devnet" },
];

function Card({ className, inner, children, delay = 0 }: { className?: string; inner?: string; children: React.ReactNode; delay?: number }) {
  return (
    <Reveal delay={delay} className={className}>
      <Spotlight className={cn("glass h-full rounded-[28px] p-7", inner)}>{children}</Spotlight>
    </Reveal>
  );
}

function Quickstart({ className }: { className?: string }) {
  const [tab, setTab] = useState(QUICK[0].id);
  const cur = QUICK.find((q) => q.id === tab)!;
  return (
    <Snippet value={tab} onValueChange={setTab} className={cn("glass rounded-2xl border-[var(--glass-border)] text-left", className)}>
      <SnippetHeader className="border-[var(--glass-border)] bg-transparent px-2">
        <SnippetTabsList className="rounded-full bg-transparent">
          {QUICK.map((q) => (
            <SnippetTabsTrigger key={q.id} value={q.id} className={TAB}>
              <span className="font-mono">{q.label}</span>
            </SnippetTabsTrigger>
          ))}
        </SnippetTabsList>
        <SnippetCopyButton value={cur.cmd} className="opacity-100" />
      </SnippetHeader>
      {QUICK.map((q) => (
        <SnippetTabsContent key={q.id} value={q.id} className="overflow-x-auto bg-transparent px-4 py-3.5 font-mono text-[12.5px] text-muted-foreground">
          <span className="text-faint">$ </span>
          {q.cmd}
        </SnippetTabsContent>
      ))}
    </Snippet>
  );
}

export default function Home() {
  const hero = RUNS["sign/sovereign-account"] ?? RUNS["private/private-payroll"];
  return (
    <div className="relative overflow-x-clip">
      {/* backdrop: slow grey mesh, faded out below the fold */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1100px] [mask-image:linear-gradient(to_bottom,black_30%,transparent)]">
        <MeshGradient className="size-full opacity-70 dark:opacity-100" colors={["#060606", "#1c1c1c", "#3a3a3a", "#0b0b0b"]} distortion={0.9} swirl={0.4} speed={0.25} />
      </div>

      {/* hero */}
      <section className="relative px-4 pt-32 text-center sm:px-6 sm:pt-36">
        <div className="mx-auto flex max-w-[900px] flex-col items-center">
          <Reveal className="mb-2">
            <MetalPopcorn size={200} />
          </Reveal>
          <Reveal delay={0.1}>
            <span className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-foreground" />
              EIP-8141 frame transactions · ERC-8421 alternative mempool
            </span>
          </Reveal>
          <Reveal delay={0.2}>
            <h1 className="text-chrome mt-7 text-[42px] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-[56px] md:text-[78px]">
              OpenZeppelin for
              <br />
              frame transactions.
            </h1>
          </Reveal>
          <Reveal delay={0.3}>
            <p className="mx-auto mt-6 max-w-[600px] text-[16px] leading-relaxed text-muted-foreground sm:text-[17px]">
              Reviewed building blocks for keeping DeFi safe when contracts approve and pay for their own transactions. A rule contract acts when its condition is true, not when a key signs.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <PrimaryLink href={href("modules")}>Browse modules</PrimaryLink>
              <GhostLink href={href("examples", "sign", "sovereign-account")}>Watch the flagship play</GhostLink>
            </div>
          </Reveal>
          <Reveal delay={0.4} className="mt-8 w-full max-w-[640px]">
            <Quickstart />
          </Reveal>
        </div>

        {/* the player, live in the hero */}
        <div className="relative mx-auto mt-20 max-w-[1120px] text-left">
          <div className="pointer-events-none absolute left-1/2 top-0 h-48 w-[70%] -translate-x-1/2 -translate-y-1/3 rounded-full bg-foreground/[0.07] blur-3xl" />
          <TiltOnScroll>{hero && <Player run={hero} compact autoplay loop />}</TiltOnScroll>
        </div>

        <div className="mx-auto mt-24 grid max-w-[1120px] grid-cols-2 gap-y-10 text-left md:grid-cols-4">
          {stats.map((st, i) => (
            <Reveal key={st.label} delay={i * 0.08} className="border-l border-[var(--glass-border)] pl-5 sm:pl-6">
              <CountUp to={st.v} suffix={st.s} className="font-pixel text-[40px] leading-none sm:text-[48px]" />
              <p className="mt-4 text-[14px] text-foreground">{st.label}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">{st.sub}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* the four mistakes */}
      <section className="px-4 pt-36 sm:px-6">
        <div className="mx-auto max-w-[1120px]">
          <SectionHead
            label="Four new mistakes"
            title="A contract that pays for strangers' transactions is easy to get wrong."
            sub="Frame transactions let a contract approve and pay for its own transactions. Popcorn is the safe default for each new thing that can go wrong."
          />
          <div className="mt-12 grid gap-4 md:grid-cols-6">
            <Card className="md:col-span-4">
              <HealthCard />
            </Card>
            <Card className="md:col-span-2" inner="flex flex-col" delay={0.08}>
              <PayerCard />
            </Card>
            <Card className="md:col-span-2" inner="flex flex-col" delay={0.16}>
              <LayoutCard />
            </Card>
            <Card className="md:col-span-4" inner="overflow-hidden !p-0">
              <Code files={loop.map((l) => ({ filename: l.filename, lang: l.language, code: l.code }))} className="rounded-none border-0 bg-transparent shadow-none [backdrop-filter:none]" />
            </Card>
            <Card className="md:col-span-3" inner="flex flex-col">
              <VerdictCard />
            </Card>
            <Card className="md:col-span-3" delay={0.08}>
              <p className="label-mono">Conditions and signers</p>
              <h3 className="mt-3 text-[17px] font-semibold tracking-tight">No hand-rolled checks.</h3>
              <div className="mt-6 grid grid-cols-2 gap-2 font-mono text-[11.5px]">
                {["threshold", "rule sets", "Groth16 proof", "ECDSA", "passkeys", "WOTS+", "FORS", "XMSS", "SPHINCS+", "Falcon-512", "M-of-N", "attested facts"].map((x, i) => (
                  <span key={x} className={cn("rounded-full border px-3 py-1.5", i > 4 && i < 10 ? "border-foreground/30 text-foreground" : "border-[var(--glass-border)] text-muted-foreground")}>
                    {x}
                  </span>
                ))}
              </div>
              <p className="mt-5 text-[12px] leading-relaxed text-faint">Outlined: post-quantum (hash-based and lattice). Groth16 is zero-knowledge, not post-quantum.</p>
            </Card>
          </div>
        </div>
      </section>

      {/* featured examples */}
      <section className="px-4 pt-36 sm:px-6">
        <div className="mx-auto max-w-[1120px]">
          <SectionHead label="Examples" title="Whole projects, recorded on a devnet." sub="Each one solves a real problem with several modules. Every transaction happened, sent by a key with no ETH. Flip any of them to the refused case." />
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {featured.map((d, i) => (
              <Reveal key={d.key} delay={i * 0.08}>
                <Peel
                  side="right"
                  mode="hover"
                  reveal={120}
                  className="h-full rounded-[28px]"
                  under={
                    <a href={href("examples", ...d.key.split("/"))} className="flex h-full items-center justify-end rounded-[28px] bg-foreground pr-6 text-[13px] font-medium text-background">
                      Play <ArrowRight className="ml-1 size-4" />
                    </a>
                  }
                >
                  <Spotlight className="glass group flex h-full flex-col rounded-[28px] p-7 text-left transition-transform duration-300 hover:-translate-y-1">
                    <a href={href("examples", ...d.key.split("/"))} className="flex h-full flex-col">
                      <span className="font-pixel text-[32px] leading-none text-muted-foreground transition-colors group-hover:text-foreground">{d.n}</span>
                      <h3 className="mt-8 text-[19px] font-semibold tracking-tight">{d.t}</h3>
                      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{d.d}</p>
                      <div className="mt-auto flex items-center justify-between border-t border-[var(--glass-border)] pt-4">
                        <span className="font-mono text-[11px] text-muted-foreground">{d.tag}</span>
                        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                      </div>
                    </a>
                  </Spotlight>
                </Peel>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* the catalog at a glance */}
      <section className="px-4 pt-36 sm:px-6">
        <div className="mx-auto max-w-[1120px]">
          <SectionHead label="Five use cases" title="Start from what you need to do." sub="Censorship resistance, privacy, security and post-quantum are built into every module. You pick the job." />
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {CORNERS.map((c, i) => {
              const mods = MODULES.filter((m) => m.corner === c.id);
              const built = mods.filter((m) => m.status === "built").length;
              return (
                <Reveal key={c.id} delay={(i % 4) * 0.06}>
                  <Spotlight className="glass group h-full rounded-[24px]">
                    <a href={href("modules", c.id)} className="flex h-full flex-col p-6">
                      <div className="flex items-center justify-between">
                        <span className="font-pixel text-[13px] text-faint">0{i + 1}</span>
                        <ArrowUpRight className="size-4 text-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </div>
                      <h3 className="mt-6 text-[17px] font-semibold tracking-tight">{c.name}</h3>
                      <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{c.does}</p>
                      <div className="mt-6 flex items-center gap-2">
                        <div className="flex flex-1 gap-0.5">
                          {mods.map((m) => (
                            <span key={m.id} className={cn("h-1 flex-1 rounded-full", m.status === "built" ? "bg-foreground" : "bg-foreground/15")} />
                          ))}
                        </div>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {built}/{mods.length}
                        </span>
                      </div>
                    </a>
                  </Spotlight>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* surfaces */}
      <section className="px-4 pt-36 sm:px-6">
        <div className="mx-auto max-w-[1120px]">
          <SectionHead label="Four ways in" title="Use it the way your team works." />
          <div className="mt-12 grid gap-3 md:grid-cols-4">
            {[
              { t: "SDK", d: "A viem extension and a signer for every scheme.", s: "built" as const, h: href("docs", "sdk") },
              { t: "Contracts", d: "Core, conditions, signers, payers and templates in Solidity and Yul.", s: "built" as const, h: href("docs", "contracts") },
              { t: "Claude skills", d: "Describe the protection you want; get the rule file.", s: "planned" as const, h: href("skills") },
              { t: "MCP server", d: "Read-only tools that plan and check rules. Never holds a key.", s: "planned" as const, h: href("mcp") },
            ].map((x, i) => (
              <Reveal key={x.t} delay={i * 0.06}>
                <a href={x.h} className="glass group flex h-full flex-col rounded-[24px] p-6 transition-transform duration-300 hover:-translate-y-1">
                  <StatusBadge status={x.s} className="self-start" />
                  <h3 className="mt-6 text-[17px] font-semibold tracking-tight">{x.t}</h3>
                  <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{x.d}</p>
                </a>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* closing */}
      <section className="px-4 py-36 sm:px-6">
        <Reveal>
          <div className="glass hatch relative mx-auto flex max-w-[1120px] flex-col items-center overflow-hidden rounded-[36px] px-6 py-20 text-center">
            <img src="/popcorn.svg" alt="" className="size-14" />
            <h2 className="text-chrome mt-6 text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[44px]">Pick a module. Watch it run. Copy it.</h2>
            <p className="mt-4 max-w-[520px] text-[15px] text-muted-foreground">Reviewed by us, not externally audited. Every module page lists what it cannot do.</p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <PrimaryLink href={href("modules")}>Browse modules</PrimaryLink>
              <GhostLink href={REPO} external>
                Repository
              </GhostLink>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
