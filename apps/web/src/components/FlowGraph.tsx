import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Flow, FlowNodeView, NodeResult } from "@popcorn/sdk/inspect";
import { blockById } from "@/lib/catalog";
import { href } from "@/lib/route";
import { cn } from "@/lib/utils";

// A build's flow drawn like a workflow: the trigger on the left, then the payer and the conditions, the logic operators,
// and the actions, each node coloured by what it did for this transaction. Green: YES (or ran). Red: NO or UNKNOWN (an
// UNKNOWN never fires). Grey: not reached, because an earlier node already decided. Dashed: the chain does not record it.

const W = 232;
const H = 112;
const GAP_X = 56;
const GAP_Y = 18;

const RESULT_TEXT: Record<NodeResult, string> = { yes: "YES", no: "NO", unknown: "UNKNOWN", skipped: "NOT REACHED", "not-recorded": "NOT RECORDED" };
const ACTION_TEXT: Partial<Record<NodeResult, string>> = { yes: "RUNS", no: "FAILED", skipped: "NOT REACHED" };

const tone = (r: NodeResult) =>
  r === "yes"
    ? "border-emerald-500/60 bg-emerald-500/[0.08]"
    : r === "no" || r === "unknown"
      ? "border-red-500/70 bg-red-500/[0.09]"
      : r === "not-recorded"
        ? "border-dashed border-foreground/25 bg-transparent"
        : "border-foreground/10 bg-foreground/[0.02] opacity-55";
const badge = (r: NodeResult) =>
  r === "yes" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : r === "no" || r === "unknown" ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-foreground/[0.06] text-muted-foreground";
const stroke = (from: NodeResult, to: NodeResult) =>
  to === "skipped" ? "var(--flow-grey)" : from === "yes" ? "var(--flow-green)" : from === "no" || from === "unknown" ? "var(--flow-red)" : "var(--flow-grey)";

const KIND: Record<FlowNodeView["kind"], string> = { trigger: "Trigger", payer: "Gas payer", condition: "Condition", operator: "Operator", action: "Action" };

function layout(nodes: FlowNodeView[]) {
  const col: number[] = [];
  nodes.forEach((n, i) => {
    col[i] = n.inputs.length ? Math.max(...n.inputs.map((j) => (col[j] ?? 0) + 1)) : 0;
  });
  const rows = new Map<number, number>();
  const pos = nodes.map((_, i) => {
    const c = col[i]!;
    const r = rows.get(c) ?? 0;
    rows.set(c, r + 1);
    return { x: c * (W + GAP_X), y: r * (H + GAP_Y) };
  });
  const width = (Math.max(...col) + 1) * (W + GAP_X) - GAP_X;
  const height = Math.max(...[...rows.values()]) * (H + GAP_Y) - GAP_Y;
  return { pos, width, height };
}

export function FlowGraph({ flow, className }: { flow: Flow; className?: string }) {
  const { pos, width, height } = useMemo(() => layout(flow.nodes), [flow]);
  const ref = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => setFits(el.clientWidth >= width);
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div className={className}>
      <div ref={ref} className="overflow-x-auto pb-2 [--flow-green:rgb(16_185_129/0.75)] [--flow-grey:color-mix(in_oklab,currentColor_18%,transparent)] [--flow-red:rgb(239_68_68/0.8)]">
        <div className="relative" style={{ width, height }}>
          <svg className="absolute inset-0 overflow-visible" width={width} height={height} aria-hidden>
            {flow.nodes.flatMap((n, i) =>
              n.inputs.map((j) => {
                const a = pos[j]!;
                const b = pos[i]!;
                const x1 = a.x + W;
                const y1 = a.y + H / 2;
                const x2 = b.x;
                const y2 = b.y + H / 2;
                const mx = (x1 + x2) / 2;
                const from = flow.nodes[j]!.result;
                return (
                  <motion.path
                    key={`${j}-${i}`}
                    d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                    fill="none"
                    stroke={stroke(from, n.result)}
                    strokeWidth={from === "yes" && n.result !== "skipped" ? 2 : 1.25}
                    strokeDasharray={n.result === "skipped" || from === "not-recorded" ? "4 5" : undefined}
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.5, delay: 0.08 * j }}
                  />
                );
              }),
            )}
          </svg>
          {flow.nodes.map((n, i) => (
            <FlowCard key={i} n={n} x={pos[i]!.x} y={pos[i]!.y} delay={0.06 * i} />
          ))}
        </div>
      </div>
      {!fits && <p className="mt-1 font-mono text-[10.5px] text-faint">scroll sideways for the rest of the flow →</p>}
    </div>
  );
}

function FlowCard({ n, x, y, delay }: { n: FlowNodeView; x: number; y: number; delay: number }) {
  const b = n.blockId ? blockById(n.blockId) : undefined;
  const op = n.kind === "operator";
  const title = op ? (b?.name ?? n.label) : (b?.name ?? (n.kind === "trigger" ? "Trigger" : "Build check"));
  const res = n.kind === "action" ? (ACTION_TEXT[n.result] ?? RESULT_TEXT[n.result]) : RESULT_TEXT[n.result];
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint">{KIND[n.kind]}</span>
        <span className={cn("rounded-full px-1.5 py-0.5 font-mono text-[9.5px] font-medium tracking-[0.04em]", badge(n.result))}>{res}</span>
      </div>
      <p className="mt-1.5 truncate text-[13.5px] font-semibold tracking-tight">{title}</p>
      <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">{op && b ? n.label.replace(/^(AND|OR|NOT)$/, "") || b.sections["Overview"]?.split(".")[0] : n.label}</p>
    </>
  );
  const cls = cn("absolute flex flex-col rounded-2xl border px-3 py-2.5 backdrop-blur-sm transition-colors", tone(n.result), b && "hover:border-foreground/50");
  const style = { left: x, top: y, width: W, height: H };
  const tip = [n.label, n.observation, n.note].filter(Boolean).join("\n");
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay }} className="contents">
      {b ? (
        <a href={href("blocks", b.id)} className={cls} style={style} title={tip}>
          {body}
        </a>
      ) : (
        <div className={cls} style={style} title={tip}>
          {body}
        </div>
      )}
    </motion.div>
  );
}

/** The nodes that decided the outcome: the red ones, with their notes. */
export function FlowVerdict({ flow, recorded = false }: { flow: Flow; recorded?: boolean }) {
  const red = flow.nodes.filter((n) => n.result === "no" || n.result === "unknown");
  const ran = flow.nodes.some((n) => n.kind === "action" && n.result === "yes");
  return (
    <div className="mt-4 space-y-1.5 text-[13px] leading-relaxed">
      {ran && red.length === 0 && <p className="text-emerald-600 dark:text-emerald-400">Every node on the path said YES, so the actions run.</p>}
      {red.map((n) => (
        <p key={n.index} className="text-foreground/90">
          <span className="font-mono text-[11px] text-red-600 dark:text-red-400">{n.result === "unknown" ? "UNKNOWN" : "NO"}</span>{" "}
          <span className="font-medium">{blockById(n.blockId)?.name ?? (n.kind === "trigger" ? "Trigger" : "Build check")}</span>: {n.note ?? n.label}
        </p>
      ))}
      <p className="font-mono text-[10.5px] text-faint">
        {flow.evaluated === "inclusion"
          ? "Derived from the inclusion: the chain proves the condition held when it ran (dashed nodes are not recorded on chain)."
          : flow.source === "opaque"
            ? "This build has no explain view: only its overall answer is known."
            : recorded ? `Recorded evaluation${flow.observedBlock !== undefined ? ` at block ${flow.observedBlock}` : " during the demo"}. This is saved evidence, not a live state check.`
            : `Evaluated ${flow.observedBlock !== undefined ? `at block ${flow.observedBlock}` : "now"} by the build's ${flow.source === "ruleset" ? "rule-set debug view" : "popcornExplain view"} on the current state.`}
      </p>
    </div>
  );
}
