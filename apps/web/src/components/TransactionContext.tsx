import type { Inspection } from "@popcorn/sdk/inspect";
import { TRACES, transactionsIn } from "@/lib/incidents";
import { contractRelations, neighbors } from "@/lib/trace-model";
import { blockById } from "@/lib/catalog";
import { href } from "@/lib/route";

export function TransactionContext({ inspection, network }: { inspection: Inspection; network: string }) {
  const members = transactionsIn(inspection.hash, network);
  const related = contractRelations(TRACES, inspection, network);
  return <div className="space-y-4">
    {members.map(({ context, step }) => {
      const { previous, next } = neighbors(context, step);
      const sequence = context.steps.filter((item) => item.ordered);
      const conditions = step.flow?.nodes.filter((node) => node.kind === "condition") ?? [];
      return <section key={context.id} className="glass rounded-2xl p-5 sm:p-6" aria-label="Transaction context">
        <p className="label-mono">Recorded {context.kind} · chain {context.chainId}</p>
        <a className="mt-2 inline-block text-[20px] font-semibold tracking-tight underline-offset-4 hover:underline" href={href("explorer", "incident", context.id, step.tx)}>{context.title} →</a>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{context.summary}</p>
        <h2 className="mt-5 text-[16px] font-semibold">{step.title}</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">Role: {step.role} · {step.ordered ? `Step ${sequence.indexOf(step) + 1} of ${sequence.length}` : "Refused attempt; position in sequence not recorded"}</p>
        {step.detail !== step.title && <p className="mt-3 break-words text-[14px] leading-relaxed text-muted-foreground">{step.detail}</p>}
        {step.attempts?.map((attempt, i) => <p key={i} className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{attempt.detail}</p>)}
        {step.kind === "ordinary" && <p className="mt-3 text-[13px] text-muted-foreground">An ordinary transaction in this incident. It does not run Popcorn validation frames.</p>}
        {conditions.length > 0 && <div className="mt-4"><p className="text-[12px] font-medium">Conditions for this step</p><ul className="mt-2 space-y-1 text-[13px] text-muted-foreground">{conditions.map((node) => <li key={node.index}><span className="font-medium text-foreground">{node.result.replaceAll("-", " ").toUpperCase()}</span> · {node.label}</li>)}</ul><p className="mt-2 text-[11px] text-muted-foreground">Saved explanation: {step.flow?.evaluated === "inclusion" ? "derived from inclusion" : "evaluated when this attempt was recorded"}.</p></div>}
        {step.blockIds.some((id) => blockById(id)) && <div className="mt-3 flex flex-wrap gap-3 text-[12px]">{step.blockIds.filter((id) => blockById(id)).map((id) => <a key={id} className="underline underline-offset-4 text-muted-foreground" href={href("blocks", id)}>{blockById(id)!.name}</a>)}</div>}
        {(previous || next) && <nav aria-label="Adjacent transactions" className="mt-5 grid gap-3 border-t border-[var(--glass-border)] pt-4 sm:grid-cols-2">
          {previous ? <a href={href("explorer", context.network, previous.tx)} className="text-[13px] text-muted-foreground hover:text-foreground"><span className="block text-[11px]">← Previous recorded step</span>{previous.title}</a> : <span />}
          {next && <a href={href("explorer", context.network, next.tx)} className="text-[13px] text-muted-foreground hover:text-foreground"><span className="block text-[11px]">Next recorded step →</span>{next.title}</a>}
        </nav>}
        <details className="mt-4 border-t border-[var(--glass-border)] pt-3">
          <summary className="cursor-pointer text-[13px]">All {context.steps.length} related transactions</summary>
          <ol className="mt-3 space-y-1" aria-label="Related transactions">{context.steps.map((item) => <li key={item.tx}><a href={href("explorer", context.network, item.tx)} aria-current={item.tx === step.tx ? "step" : undefined} className={`block rounded-lg px-3 py-2 text-[13px] ${item.tx === step.tx ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]"}`}><span className="block">{item.title}</span><span className="mt-1 block text-[11px] text-muted-foreground">{item.outcome} · {item.tx.slice(0, 10)}…{!item.ordered ? " · order not recorded" : ""}</span></a></li>)}</ol>
        </details>
      </section>;
    })}
    {members.length === 0 && <section className="glass rounded-2xl p-5"><h2 className="text-[15px] font-semibold">No incident membership recorded</h2><p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">This hash is not in the available incident or example recordings. The chain facts below explain this transaction on its own; an incident cannot be inferred from a hash alone.</p></section>}
    {related.length > 0 && <section className="glass rounded-2xl p-5"><h2 className="text-[15px] font-semibold">Related by contract</h2><p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">This transaction touches a contract used in these recordings. That connection does not establish incident membership or causation.</p><ul className="mt-3 space-y-2 text-[13px]">{related.map((context) => <li key={context.id}><a href={href("explorer", "incident", context.id)} className="underline underline-offset-4">{context.title} →</a></li>)}</ul></section>}
  </div>;
}
