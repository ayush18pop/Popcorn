import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Pill, PillIndicator } from "@/components/kibo-ui/pill";
import { CodeBlock, CodeBlockBody, CodeBlockContent, CodeBlockCopyButton, CodeBlockFilename, CodeBlockFiles, CodeBlockHeader, CodeBlockItem } from "@/components/kibo-ui/code-block";
import { Reveal } from "@/components/motion";
import { RUNS_ON_TEXT, type Block, type Status } from "@/lib/catalog";
import { monoThemes } from "@/lib/mono-theme";
import { cn } from "@/lib/utils";

/** Tab trigger look shared by every Tabs on the site. */
export const TAB = "rounded-full px-3 text-[12px] data-[state=active]:bg-foreground/[0.08] data-[state=active]:text-foreground data-[state=active]:shadow-none";

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <Pill variant="outline" className={cn("border-[var(--glass-border)] bg-transparent px-2.5 py-1 font-mono text-[11px]", status !== "built" && "text-muted-foreground", className)}>
      {status === "built" ? <PillIndicator pulse /> : <span className="size-2 rounded-full border border-foreground/40" />}
      {status}
    </Pill>
  );
}

/** Where the block runs, as positive chips only (decision 67), with the reason on hover. */
export function MempoolBadges({ m, className }: { m: Block; className?: string }) {
  const why = m.sections["Mempool"];
  return (
    <div className={cn("flex flex-wrap gap-1.5 font-mono text-[11px]", className)} title={why}>
      {m.runsOn.map((r) => (
        <span key={r} className="rounded-full border border-foreground/30 px-2.5 py-1 text-foreground">
          ✓ {RUNS_ON_TEXT[r]}
        </span>
      ))}
    </div>
  );
}

export function GasTag({ m }: { m: Block }) {
  if (!m.gas) return <span className="font-mono text-[11px] text-faint">gas · not measured yet</span>;
  return (
    <span className="font-mono text-[11px] text-muted-foreground">
      {m.gas.total !== undefined ? `${m.gas.total.toLocaleString("en-US")} gas per transaction` : `~${(m.gas.validation ?? 0).toLocaleString("en-US")} validation gas`} · <span className="text-foreground">{m.gas.tag}</span>
      {m.gas.tag === "measured" && ` · ${m.gas.network}`}
    </span>
  );
}

export function SectionHead({ label, title, sub, className }: { label: string; title: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <Reveal className={className}>
      <p className="label-mono mb-3">{label}</p>
      <h2 className="text-chrome max-w-[720px] text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[40px]">{title}</h2>
      {sub && <p className="mt-4 max-w-[580px] text-[15px] leading-relaxed text-muted-foreground">{sub}</p>}
    </Reveal>
  );
}

export function PrimaryLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} className={cn("btn-solid inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-6 text-[14px] font-medium text-background", className)}>
      {children} <ArrowRight className="size-4" />
    </a>
  );
}

export function GhostLink({ href, children, external, className }: { href: string; children: ReactNode; external?: boolean; className?: string }) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={cn("glass inline-flex h-12 items-center gap-2 rounded-full px-6 text-[14px] text-muted-foreground transition-colors hover:text-foreground", className)}
    >
      {children}
      {external && <ArrowUpRight className="size-4" />}
    </a>
  );
}

const LANG: Record<string, string> = { sh: "bash", shell: "bash", bash: "bash", ts: "ts", typescript: "ts", solidity: "solidity", sol: "solidity", json: "json", text: "text" };

/** Glass code panel with filename tabs, copy and the monochrome Shiki theme. */
export function Code({ files, className }: { files: { filename: string; lang: string; code: string }[]; className?: string }) {
  const data = files.map((f, i) => ({ language: `${LANG[f.lang] ?? "text"}#${i}`, filename: f.filename, code: f.code, lang: LANG[f.lang] ?? "text" }));
  return (
    <CodeBlock data={data} defaultValue={data[0].language} className={cn("glass rounded-2xl border-[var(--glass-border)] bg-transparent", className)}>
      <CodeBlockHeader className="border-[var(--glass-border)] bg-transparent px-3">
        <CodeBlockFiles>
          {(item) => (
            <CodeBlockFilename key={item.language} value={item.language}>
              <span className="font-mono text-[11px]">{item.filename}</span>
            </CodeBlockFilename>
          )}
        </CodeBlockFiles>
        <CodeBlockCopyButton />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem key={item.language} value={item.language} className="[&_code]:min-w-max [&_pre]:!bg-transparent [&_pre]:overflow-x-auto [&_pre]:text-[12.5px]">
            <CodeBlockContent language={(item as unknown as { lang: string }).lang as never} themes={monoThemes}>
              {item.code}
            </CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  );
}

/** Pull the first fenced block out of a Markdown section. */
export function fenced(md: string | undefined): { lang: string; code: string } | null {
  return fencedAll(md)[0] ?? null;
}

/** Every fenced block in a Markdown section, in order. */
export function fencedAll(md: string | undefined): { lang: string; code: string }[] {
  return [...(md ?? "").matchAll(/```(\w*)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1] || "text", code: m[2]!.replace(/\n$/, "") }));
}

export function Footer() {
  return (
    <footer className="border-t border-[var(--glass-border)] px-6 py-10">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 text-[13px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <img src="/popcorn.svg" alt="" className="size-4" /> popcorn
        </span>
        <span>Reviewed building blocks for frame transactions. Reviewed by us, not externally audited. MIT.</span>
      </div>
    </footer>
  );
}
