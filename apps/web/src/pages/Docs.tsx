import { Children, isValidElement, useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion";
import { Hash, Search } from "lucide-react";
import { RULES } from "@popcorn/simulator";
import { Code } from "@/components/bits";
import { REPO, repoFile } from "@/lib/catalog";
import { href } from "@/lib/route";
import { cn } from "@/lib/utils";
import sdkReadme from "../../../../packages/sdk/README.md?raw";
import layout from "../../../../contracts/core/LAYOUT.md?raw";
import devnetReadme from "../../../../devnet/README.md?raw";
import decisions from "../../../../journal/DECISIONS.md?raw";

// The docs render the repository's own Markdown, so they cannot drift from the code. Only the rule glossary and the
// frame-transaction glossary are built here, and the rule glossary is the simulator's table itself.

type Doc = { id: string; title: string; source: string; md?: string };

const DOCS: Doc[] = [
  { id: "sdk", title: "SDK reference", source: "packages/sdk/README.md", md: sdkReadme },
  { id: "contracts", title: "Core: arguments, constants, errors", source: "contracts/core/LAYOUT.md", md: layout },
  { id: "devnets", title: "Devnets", source: "devnet/README.md", md: devnetReadme },
  { id: "rules", title: "Rule glossary", source: "packages/simulator/src/rules.ts" },
  { id: "glossary", title: "Frame transactions", source: "docs/ui-handoff.md" },
  { id: "decisions", title: "Design decisions", source: "journal/DECISIONS.md", md: decisions },
];

const TERMS: [string, string][] = [
  ["Frame transaction", "An EIP-8141 transaction made of frames. Validation frames run first and decide whether the transaction is valid and who pays."],
  ["Frame", "One call inside a frame transaction, with its own mode, target, gas limit and data."],
  ["VERIFY", "A validation frame. It must approve execution, payment or both; if it does not, the transaction is invalid and nobody pays."],
  ["SENDER", "A frame that runs as the transaction's sender. In Popcorn it runs the rule contract's action."],
  ["Flags", "Which approvals a frame may give: 1 payment, 2 execution, 3 both. Bit 2 marks an atomic batch."],
  ["Rule contract", "A contract that approves its own transactions when its condition is true. Core plus the developer's logic."],
  ["Condition", "The check that decides whether a trigger is valid, run in VERIFY in the rule contract's own storage."],
  ["Trigger", "The transaction that runs a rule contract. Anyone can send it; a false condition makes it invalid."],
  ["Trigger data (popArgs)", "The SENDER frame's calldata; VERIFY reads the same bytes, so the condition and the action see the same inputs."],
  ["Nonce key", "An EIP-8250 key. A rule derives it from state its action advances, so each event can fire once."],
  ["Rule-pays / caller-pays", "Who pays the gas: the rule contract's balance, or a separate payer who earns the reward."],
  ["Alternative mempool", "ERC-8421: sidecars that admit transactions the public mempool would refuse, with per-entity budgets and stake."],
  ["Stake", "A deposit in the staking registry. A staked rule contract may read other contracts during validation on the alternative mempool."],
  ["VERIFY floor", "The least VERIFY gas Core accepts, so the condition always gets its full budget (Core error 0x27)."],
];

const slug = (s: string) => s.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
const text = (n: ReactNode): string =>
  Children.toArray(n).map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : isValidElement(c) ? text((c.props as { children?: ReactNode }).children) : "")).join("");

function headings(md: string) {
  const out: { depth: 2 | 3; text: string; id: string }[] = [];
  let fence = false;
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) fence = !fence;
    if (fence) continue;
    const m = /^(##|###) (.+)$/.exec(line);
    if (m) out.push({ depth: m[1].length as 2 | 3, text: m[2].replace(/`/g, ""), id: slug(m[2]) });
  }
  return out;
}

const jump = (doc: string, id: string) => {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", `#/docs/${doc}/${id}`);
};

function components(doc: Doc): Components {
  return {
    h1: () => null,
    h2: ({ children }) => {
      const id = slug(text(children));
      return (
        <h2 id={id} className="group mt-20 scroll-mt-28 border-t border-[var(--glass-border)] pt-10 text-[28px] font-semibold tracking-[-0.03em] first:mt-0 first:border-0 first:pt-0">
          <a href={`#/docs/${doc.id}/${id}`} onClick={(e) => (e.preventDefault(), jump(doc.id, id))} className="inline-flex items-center gap-2">
            <span className="text-chrome">{children}</span>
            <Hash className="size-4 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
          </a>
        </h2>
      );
    },
    h3: ({ children }) => {
      const id = slug(text(children));
      return (
        <h3 id={id} className="mt-12 scroll-mt-28 text-[19px] font-semibold tracking-tight">
          {children}
        </h3>
      );
    },
    p: ({ children }) => <p className="mt-4 text-[15px] leading-[1.75] text-foreground/80">{children}</p>,
    ul: ({ children }) => <ul className="mt-4 space-y-2 pl-5 text-[15px] leading-[1.7] text-foreground/80 marker:text-faint [list-style:disc]">{children}</ul>,
    ol: ({ children }) => <ol className="mt-4 space-y-2 pl-5 text-[15px] leading-[1.7] text-foreground/80 marker:font-mono marker:text-faint [list-style:decimal]">{children}</ol>,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    blockquote: ({ children }) => <blockquote className="glass mt-6 rounded-2xl px-5 py-1 [&_p]:text-muted-foreground">{children}</blockquote>,
    hr: () => <hr className="my-12 border-[var(--glass-border)]" />,
    a: ({ href: h = "", children }) => {
      if (/^https?:/.test(h))
        return (
          <a href={h} target="_blank" rel="noreferrer" className="text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
            {children}
          </a>
        );
      if (h.startsWith("#")) return <a href={`#/docs/${doc.id}/${h.slice(1)}`} className="text-foreground underline decoration-foreground/30 underline-offset-4">{children}</a>;
      // repo-relative path: link to the file in the repository
      const base = doc.source.split("/").slice(0, -1);
      const parts = [...base];
      for (const seg of h.split("/")) seg === ".." ? parts.pop() : seg !== "." && parts.push(seg);
      return (
        <a href={repoFile(parts.join("/"))} target="_blank" rel="noreferrer" className="text-foreground underline decoration-foreground/30 underline-offset-4">
          {children}
        </a>
      );
    },
    code: ({ className, children }) => {
      const raw = String(children ?? "");
      const lang = /language-(\w+)/.exec(className ?? "")?.[1];
      if (lang !== undefined || raw.includes("\n")) return <Code className="my-6" files={[{ filename: lang || "text", lang: lang ?? "text", code: raw.replace(/\n$/, "") }]} />;
      return <code className="rounded-md border border-[var(--glass-border)] bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>;
    },
    pre: ({ children }) => <>{children}</>,
    table: ({ children }) => (
      <div className="glass mt-6 overflow-x-auto rounded-2xl">
        <table className="w-full border-collapse text-left text-[13px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="border-b border-[var(--glass-border)] font-mono text-[11px] uppercase tracking-[0.05em] text-faint">{children}</thead>,
    th: ({ children }) => <th className="px-4 py-3 font-medium">{children}</th>,
    tr: ({ children }) => <tr className="border-b border-[var(--glass-border)] last:border-0">{children}</tr>,
    td: ({ children }) => <td className="px-4 py-3 align-top text-foreground/80">{children}</td>,
  };
}

function RuleGlossary() {
  const [q, setQ] = useState("");
  const [src, setSrc] = useState<string | null>(null);
  const list = RULES.filter((r) => (!src || r.source === src) && (!q || `${r.id} ${r.title} ${r.sentence}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div>
      <p className="text-[15px] leading-[1.75] text-foreground/80">
        Every rejection the Popcorn stack can produce, from Core's error codes to the alternative mempool's rule ids, with a plain-English sentence and the fix. This is the table <code className="font-mono text-[0.85em]">simulate()</code> uses, imported as is.
      </p>
      <div className="sticky top-24 z-10 mt-6 flex flex-col gap-2 rounded-2xl py-2 sm:flex-row sm:items-center">
        <div className="glass-strong flex flex-1 items-center gap-2 rounded-full px-4">
          <Search className="size-4 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 0x22, BUDGET-010, stake…" className="h-11 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-faint" />
        </div>
        <div className="glass-strong flex gap-1 rounded-full p-1">
          {[null, "core", "ethrex", "sidecar", "sdk"].map((s) => (
            <button key={s ?? "all"} onClick={() => setSrc(s)} className={cn("relative rounded-full px-3 py-1.5 font-mono text-[11px]", src === s ? "text-background" : "text-muted-foreground")}>
              {src === s && <motion.span layoutId="rule-src" className="absolute inset-0 rounded-full bg-foreground" />}
              <span className="relative">{s ?? "all"}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 font-mono text-[11px] text-faint">{list.length} of {RULES.length} rules</p>
      <div className="mt-4 space-y-2">
        <AnimatePresence initial={false}>
          {list.slice(0, 120).map((r) => (
            <motion.div key={r.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} id={r.id} className="glass rounded-2xl px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[12px] text-foreground">{r.id}</span>
                <span className="font-mono text-[10.5px] text-faint">
                  {r.source} · {r.mempool} · {r.severity}
                </span>
              </div>
              <p className="mt-2 text-[14px] font-medium">{r.title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{r.sentence}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-foreground/80">
                <span className="font-mono text-[11px] text-faint">fix </span>
                {r.fix}
              </p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function FrameGlossary() {
  return (
    <dl className="divide-y divide-[var(--glass-border)] border-y border-[var(--glass-border)]">
      {TERMS.map(([k, v]) => (
        <div key={k} id={slug(k)} className="grid scroll-mt-28 gap-2 py-4 sm:grid-cols-[200px_1fr] sm:gap-6">
          <dt className="text-[14px] font-medium">{k}</dt>
          <dd className="text-[14px] leading-relaxed text-foreground/80">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function Docs({ section, anchor }: { section?: string; anchor?: string }) {
  const doc = DOCS.find((d) => d.id === section) ?? DOCS[0];
  const hs = useMemo(() => (doc.md ? headings(doc.md) : []), [doc]);
  const [active, setActive] = useState(hs[0]?.id);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 30 });
  const md = useMemo(() => components(doc), [doc]);

  useEffect(() => {
    const on = () => {
      let cur = hs[0]?.id;
      for (const h of hs) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top < window.innerHeight * 0.3) cur = h.id;
      }
      setActive(cur);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [hs]);

  useEffect(() => {
    if (anchor) window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }), 60);
  }, [anchor, doc.id]);

  const h2s = hs.filter((h) => h.depth === 2);

  return (
    <div className="relative">
      <motion.div style={{ scaleX: progress }} className="fixed inset-x-0 top-0 z-[60] h-px origin-left bg-foreground/70" />
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 pb-40 pt-32 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)_200px]">
        <aside className="lg:block">
          <nav className="lg:sticky lg:top-28">
            <p className="label-mono mb-3 px-3">Docs</p>
            <div className="-mx-1 flex gap-1 overflow-x-auto pb-2 lg:mx-0 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0">
              {DOCS.map((d) => (
                <a key={d.id} href={href("docs", d.id)} className={cn("relative block shrink-0 rounded-lg px-3 py-1.5 text-[13px] transition-colors", doc.id === d.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {doc.id === d.id && <motion.span layoutId="docs-nav" className="absolute inset-0 rounded-lg border border-[var(--glass-border)] bg-foreground/[0.06]" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                  <span className="relative">{d.title}</span>
                </a>
              ))}
            </div>
            <a href={`${REPO}/blob/main/${doc.source}`} target="_blank" rel="noreferrer" className="mt-6 hidden px-3 font-mono text-[11px] text-faint hover:text-muted-foreground lg:block">
              source · {doc.source}
            </a>
          </nav>
        </aside>

        <article className="min-w-0 max-w-[760px]">
          <p className="label-mono mb-4">Docs · {doc.source}</p>
          <h1 className="text-chrome text-[40px] font-semibold leading-[1.04] tracking-[-0.04em] md:text-[52px]">{doc.title}</h1>
          <div className="mt-8">
            {doc.md ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>
                {doc.md}
              </ReactMarkdown>
            ) : doc.id === "rules" ? (
              <RuleGlossary />
            ) : (
              <FrameGlossary />
            )}
          </div>
        </article>

        <aside className="hidden lg:block">
          {h2s.length > 0 && (
            <div className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto">
              <p className="label-mono mb-3">On this page</p>
              <div className="relative border-l border-[var(--glass-border)]">
                {h2s.map((h) => (
                  <button key={h.id} onClick={() => jump(doc.id, h.id)} className={cn("relative block w-full py-1.5 pl-4 text-left text-[12.5px] leading-snug transition-colors", active === h.id || hs.find((x) => x.id === active && hs.indexOf(x) > hs.indexOf(h) && !hs.slice(hs.indexOf(h) + 1, hs.indexOf(x)).some((y) => y.depth === 2)) ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {active === h.id && <motion.span layoutId="docs-toc" className="absolute -left-px inset-y-1 w-px bg-foreground" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                    {h.text}
                  </button>
                ))}
              </div>
              <p className="mt-8 text-[12px] leading-relaxed text-faint">
                Press <span className="font-mono text-muted-foreground">⌘K</span> to jump anywhere.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
