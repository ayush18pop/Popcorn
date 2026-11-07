import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, Loader2 } from "lucide-react";
import { formatEther } from "viem";
import { devnets, explorerTxUrl, rpcRequest } from "@popcorn/sdk/transport";
import type { TraceContext, TraceStep } from "@/lib/trace-model";
import { FlowGraph, FlowVerdict } from "@/components/FlowGraph";
import { traceById } from "@/lib/incidents";
import { blockById } from "@/lib/catalog";
import { href } from "@/lib/route";

type Verification = { status: "verified" | "unavailable" | "mismatch"; message: string };

export default function Incident({ id, focusedHash }: { id: string; focusedHash?: string }) {
  const incident = traceById(id);
  useEffect(() => { if (focusedHash) document.getElementById(`tx-${focusedHash.toLowerCase()}`)?.scrollIntoView({ block: "center" }); }, [focusedHash]);
  const [busy, setBusy] = useState(false);
  const [verification, setVerification] = useState<Record<string, Verification>>({});
  const [checkedAt, setCheckedAt] = useState<string>();

  if (!incident) return (
    <div className="mx-auto max-w-[800px] px-4 pb-24 pt-36 sm:px-6">
      <a href={href("explorer")} className="text-[13px] text-muted-foreground">← Back to explorer</a>
      <h1 className="mt-8 text-[32px] font-semibold tracking-tight">Incident not found</h1>
      <p className="mt-3 text-muted-foreground">This build of the site has no completed recording for that incident.</p>
    </div>
  );

  const story = incident.steps.filter((step) => step.ordered);
  const attempts = incident.steps.filter((step) => !step.ordered);
  const verify = async () => {
    setBusy(true);
    const results = await Promise.all(incident.steps.filter((step) => step.outcome !== "refused").map(async (step): Promise<readonly [string, Verification]> => {
      try {
        const receipt = await rpcRequest<{ status: string; blockNumber: string; transactionHash: string } | null>(devnets[incident.network].rpcUrl, "eth_getTransactionReceipt", [step.tx], { timeoutMs: 15_000 });
        if (!receipt) return [step.tx, { status: "unavailable", message: "No receipt returned. The recording is still shown below." }] as const;
        const matches = receipt.transactionHash.toLowerCase() === step.tx.toLowerCase()
          && Number(BigInt(receipt.blockNumber)) === step.block
          && BigInt(receipt.status) === (step.outcome === "success" ? 1n : 0n);
        return [step.tx, matches
          ? { status: "verified", message: "Receipt matches the recorded outcome." }
          : { status: "mismatch", message: "The live receipt does not match this recording." }] as const;
      } catch {
        return [step.tx, { status: "unavailable", message: "Could not reach the node. Showing recorded evidence." }] as const;
      }
    }));
    setVerification(Object.fromEntries(results));
    setCheckedAt(new Date().toLocaleTimeString());
    setBusy(false);
  };
  const results = Object.values(verification);
  const allVerified = results.length > 0 && results.every((result) => result.status === "verified");

  return (
    <div className="mx-auto max-w-[800px] px-4 pb-24 pt-36 sm:px-6">
      <a href={href("explorer")} className="inline-flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Explorer
      </a>
      <p className="label-mono mb-4 mt-8">Recorded {incident.kind} · {incident.network === "devnet1" ? "Public devnet" : "Local devnet"} · chain {incident.chainId}</p>
      <h1 className="text-[36px] font-semibold leading-tight tracking-tight sm:text-[48px]">{incident.title}</h1>
      <p className="mt-4 max-w-[620px] text-[16px] leading-relaxed text-muted-foreground">
        {incident.summary}
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void verify()} disabled={busy} className="glass inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-[13px] disabled:opacity-50">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} {busy ? "Checking receipts…" : "Verify on chain"}
        </button>
        <p role="status" className="text-[12px] text-muted-foreground">
          {checkedAt ? `${allVerified ? "All included and reverted receipts match" : "Some receipts could not be verified"} · checked ${checkedAt}` : "Recorded evidence. Verify checks chain receipts now."}
        </p>
      </div>

      <p className="mt-8 text-[12px] leading-relaxed text-muted-foreground">Every transaction below belongs to this recorded {incident.kind}. Their order comes from the recording; shared order alone does not prove causation.</p>
      <ol className="mt-5 space-y-4" aria-label="Incident timeline">
        {story.map((step, i) => <TimelineStep key={step.tx} step={step} number={i + 1} incident={incident} verification={verification[step.tx]} focused={focusedHash?.toLowerCase() === step.tx.toLowerCase()} />)}
      </ol>

      {attempts.length > 0 && <section className="mt-8"><h2 className="text-[20px] font-semibold">Refused attempts</h2><p className="mt-2 text-[13px] text-muted-foreground">These belong to the same example. Their position in the sequence was not recorded.</p><ol className="mt-4 space-y-4">{attempts.map((step, i) => <TimelineStep key={step.tx} step={step} number={i + 1} incident={incident} focused={focusedHash?.toLowerCase() === step.tx.toLowerCase()} />)}</ol></section>}
      <details className="glass mt-8 rounded-2xl p-5">
        <summary className="cursor-pointer text-[13px] font-medium">Contracts and recorded evidence</summary>
        <div className="mt-4 space-y-4 text-[13px] leading-relaxed text-muted-foreground">
          <p>These are separate transactions. Refused triggers stay off chain and have no receipt; their evidence comes from the recorded run.</p>
          <dl className="space-y-2 font-mono text-[11px]">
            {Object.entries(incident.contracts).map(([role, address]) => <div key={role}><dt>{role}</dt><dd className="break-all text-foreground">{address}</dd></div>)}
          </dl>
          <p>Source: <code>{incident.source}</code></p>
          <a download={`${incident.id}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(incident, null, 2))}`} className="inline-block underline underline-offset-4">Download the incident record</a>
        </div>
      </details>
    </div>
  );
}

function TimelineStep({ step, number, incident, verification, focused }: { step: TraceStep; number: number; incident: TraceContext; verification?: Verification; focused?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const protects = step.kind === "trigger" && step.outcome === "success" && step.state?.paused && step.blockIds.includes("pause");
  const status = step.outcome === "refused" ? "Refused · no gas charged" : step.outcome === "reverted" ? "Reverted on chain" : "Included on chain";
  const flow = step.flow;
  return (
    <li id={`tx-${step.tx.toLowerCase()}`} className={`glass min-w-0 scroll-mt-28 rounded-2xl p-5 sm:p-6 ${focused ? "ring-1 ring-foreground/40" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight"><span className="mr-2 text-muted-foreground">{number}.</span>{step.title}</h2>
        <span className="rounded-full bg-foreground/[0.06] px-2.5 py-1 text-[11px] text-muted-foreground">{status}</span>
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">{step.role} · {step.kind === "trigger" ? "Popcorn trigger" : step.kind === "ordinary" ? "Ordinary transaction" : "Transaction type not recorded"}{focused ? " · Selected transaction" : ""}</p>
      <p className="mt-3 break-words text-[14px] leading-relaxed text-muted-foreground">{protects ? "A sender with zero ETH triggers the protection build. It checks the conditions and pays to pause the vault." : step.detail !== step.title ? step.detail : "This recorded step performs the role described above."}</p>

      {step.attempts?.map((attempt, i) => <p key={i} className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{attempt.detail}</p>)}
      {step.blockIds.length > 0 && <div className="mt-3 flex flex-wrap gap-2 text-[12px]">{step.blockIds.filter((id) => blockById(id)).map((id) => <a key={id} className="underline underline-offset-4 text-muted-foreground" href={href("blocks", id)}>{blockById(id)?.name ?? id}</a>)}</div>}
      {protects && step.state && <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
        <p className="text-[14px] font-medium">Share price {sharePrice(step)} &lt; 1 → conditions passed → vault paused</p>
      </div>}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted-foreground">
        <a href={href("explorer", incident.network, step.tx)} rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono underline-offset-4 hover:underline" aria-label={`Inspect ${step.title}`}>
          {step.tx.slice(0, 10)}…{step.tx.slice(-6)} <ArrowUpRight className="size-3" />
        </a>
        <span>{step.block === null ? "Saved sidecar refusal" : `Block ${step.block.toLocaleString("en-US")}`}</span>
        {verification && <span className={verification.status === "verified" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{verification.message}</span>}
      </div>

      <details className="mt-4 border-t border-[var(--glass-border)] pt-3" onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary className="cursor-pointer text-[12px] text-muted-foreground">Details{protects ? " and full flow" : ""}</summary>
        {expanded && <div className="mt-4 min-w-0 space-y-4 text-[12px] leading-relaxed text-muted-foreground">
          {step.state && <p>Recorded after this step at block {step.state.block.toLocaleString("en-US")}: {formatEther(BigInt(step.state.assets))} ETH in assets, {formatEther(BigInt(step.state.shares))} shares; vault {step.state.paused ? "paused" : "not paused"}.</p>}
          {protects && step.beforeFlow?.observedBlock !== undefined && <p>Pre-submit readings at block {step.beforeFlow.observedBlock.toLocaleString("en-US")} captured the conditions before the pause. These are saved observations, not a replay of historical state.</p>}
          {protects && <p>VERIFY approves the condition and payment. SENDER runs the action. The underlying frames are in the transaction’s chain record.</p>}
          {flow && <><FlowGraph flow={flow} /><FlowVerdict flow={flow} recorded /></>}
          <a href={explorerTxUrl(step.tx, incident.network)} target="_blank" rel="noreferrer" className="inline-block underline underline-offset-4">Open in the network explorer ↗</a>
          <details><summary className="cursor-pointer">Recorded evidence</summary><pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-foreground/[0.03] p-3 font-mono text-[11px]">{JSON.stringify(step, null, 2)}</pre></details>
        </div>}
      </details>
    </li>
  );
}

function sharePrice(step: TraceStep): string {
  if (!step.state || BigInt(step.state.shares) === 0n) return "unknown";
  // Decimal arithmetic: these demo shares and assets both use 18 decimals.
  const scaled = BigInt(step.state.assets) * 10_000n / BigInt(step.state.shares);
  return `${scaled / 10_000n}.${(scaled % 10_000n).toString().padStart(4, "0")}`.replace(/\.?0+$/, "");
}
