import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Loader2, Search } from "lucide-react";
import { formatEther, getAddress, isAddress, isHash, type Address, type Hex } from "viem";
import { devnets, explorerTxUrl, rpcRequest, type DevnetName } from "@popcorn/sdk/transport";
import { inspectTransaction, type Inspection, type Stage } from "@popcorn/sdk/inspect";
import { FlowGraph, FlowVerdict } from "@/components/FlowGraph";
import { go, href } from "@/lib/route";
import { TRACES, transactionsIn, savedInspection } from "@/lib/incidents";
import { TransactionContext } from "@/components/TransactionContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SnippetCopyButton } from "@/components/kibo-ui/snippet";
import { Reveal } from "@/components/motion";
import { useScramble } from "@/lib/useScramble";
import { cn } from "@/lib/utils";

// Read-only views of a devnet, straight from the browser. Nothing here signs or sends a transaction.

// Core's runtime, when contracts/core/build.sh has been run before the site was built. Without it the explorer can
// still decode the 101 argument bytes, but says it could not compare the Core build.
const coreBuilds = import.meta.glob("../../../../contracts/core/out/PopcornCore.runtime.bin", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const CORE_RUNTIME = (Object.values(coreBuilds)[0] ?? "").trim().toLowerCase().replace(/^0x/, "");

const STAKING_REGISTRY = "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f";
const ARGS = 101;

type Args = {
  logic: Address; mode: number; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; maxGasPerFrame: bigint; maxStateGasPerFrame: bigint;
  verifier: Address; conditionGas: number; maxVerifyDataLength: number; maxTriggerDataLength: number;
};

/** The 101-byte argument layout from contracts/core/LAYOUT.md ("Argument layout"). */
function decodeArgs(hex: string): Args {
  const b = (o: number, n: number) => hex.slice(o * 2, (o + n) * 2);
  const big = (o: number, n: number) => BigInt("0x" + b(o, n));
  return {
    logic: getAddress("0x" + b(0, 20)),
    mode: Number(big(20, 1)),
    maxFeePerGas: big(21, 16),
    maxPriorityFeePerGas: big(37, 16),
    maxGasPerFrame: big(53, 8),
    maxStateGasPerFrame: big(61, 8),
    verifier: getAddress("0x" + b(69, 20)),
    conditionGas: Number(big(89, 4)),
    maxVerifyDataLength: Number(big(93, 4)),
    maxTriggerDataLength: Number(big(97, 4)),
  };
}

type Lookup =
  | { kind: "rule"; address: Address; core: "match" | "mismatch" | "unchecked"; args: Args; balance: bigint; stake: bigint | null; logicHasCode: boolean }
  | { kind: "other"; address: Address; codeSize: number; balance: bigint }
  | { kind: "tx"; ins: Inspection; recorded?: boolean }
  | { kind: "error"; message: string };

async function lookup(devnet: DevnetName, q: string): Promise<Lookup> {
  const d = devnets[devnet];
  try {
    if (isHash(q)) {
      const member = transactionsIn(q, devnet)[0];
      const roles = member ? Object.fromEntries(Object.entries(member.context.contracts).map(([name, address]) => [address, name])) : undefined;
      const ins = await inspectTransaction(q as Hex, { devnet, roles });
      const saved = savedInspection(q, devnet);
      return ins.foundOn === "nowhere" && saved ? { kind: "tx", ins: saved, recorded: true } : { kind: "tx", ins };
    }
    if (!isAddress(q)) return { kind: "error", message: "Enter a rule contract address or a transaction hash." };
    const address = getAddress(q);
    const [code, bal] = await Promise.all([rpcRequest<Hex>(d.rpcUrl, "eth_getCode", [address, "latest"]), rpcRequest<Hex>(d.rpcUrl, "eth_getBalance", [address, "latest"])]);
    const body = (code ?? "0x").slice(2).toLowerCase();
    const balance = BigInt(bal ?? "0x0");
    if (body.length < ARGS * 2) return { kind: "other", address, codeSize: body.length / 2, balance };
    const args = decodeArgs(body.slice(-ARGS * 2));
    const prefix = body.slice(0, -ARGS * 2);
    const core = CORE_RUNTIME ? (prefix === CORE_RUNTIME ? "match" : "mismatch") : "unchecked";
    if (core === "mismatch" || args.mode > 1) return { kind: "other", address, codeSize: body.length / 2, balance };
    // getDepositInfo(address) → (stake, unstakeDelay, withdrawTime); the SDK's stakeStatus.ts reads the same call
    const [logicCode, stakeRaw] = await Promise.all([
      rpcRequest<Hex>(d.rpcUrl, "eth_getCode", [args.logic, "latest"]),
      rpcRequest<Hex>(d.rpcUrl, "eth_call", [{ to: STAKING_REGISTRY, data: "0x5287ce12" + address.slice(2).toLowerCase().padStart(64, "0") }, "latest"]).catch(() => null),
    ]);
    const stake = stakeRaw && stakeRaw.length >= 66 ? BigInt(stakeRaw.slice(0, 66)) : null;
    return { kind: "rule", address, core, args, balance, stake, logicHasCode: (logicCode ?? "0x").length > 2 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "error", message: `${msg}. ${devnet === "local" ? "Is the local devnet running (devnet/up.sh)?" : "The public endpoint may block browser requests (CORS)."}` };
  }
}

interface AdmissionRow {
  txHash: Hex;
  sender: string;
  outcome: string;
  at: number;
  checks?: { rule: string; verdict: string; detail?: string }[];
}

async function listAdmissions(devnet: DevnetName): Promise<AdmissionRow[]> {
  const d = devnets[devnet];
  const r = await rpcRequest<{ items?: AdmissionRow[] } | AdmissionRow[]>(d.sidecarUrl, "skandha_explorer_listAdmissions", [{ limit: 30 }]);
  return Array.isArray(r) ? r : (r.items ?? []);
}

/** The network the explorer starts on: VITE_DEFAULT_DEVNET at build time (the deployed site sets "devnet1"), else local. */
export const DEFAULT_DEVNET: DevnetName = import.meta.env.VITE_DEFAULT_DEVNET === "devnet1" ? "devnet1" : "local";

export default function Explorer({ initial, network }: { initial?: string; network?: DevnetName }) {
  const [devnet, setDevnet] = useState<DevnetName>(network ?? DEFAULT_DEVNET);
  const [q, setQ] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Lookup | null>(null);
  const [adm, setAdm] = useState<{ ok: true; rows: AdmissionRow[] } | { ok: false; error: string } | null>(null);
  const d = devnets[devnet];

  const run = async (value: string) => {
    setBusy(true);
    const saved = savedInspection(value.trim(), devnet);
    if (saved) setRes({ kind: "tx", ins: saved, recorded: true });
    setRes(await lookup(devnet, value.trim()));
    setBusy(false);
  };
  const submit = () => {
    const v = q.trim();
    if (isHash(v)) {
      const matches = transactionsIn(v);
      const networks = [...new Set(matches.map(({ context }) => context.network))];
      const target = networks.length === 1 ? networks[0]! : devnet;
      if (initial === v && target === devnet) void run(v);
      else go("explorer", target, v);
    } else void run(v);
  };
  useEffect(() => {
    if (initial) void run(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  return (
    <div className="relative overflow-x-clip">
      <div className="hatch pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
      <div className="relative mx-auto max-w-[1120px] px-4 pb-32 pt-36 sm:px-6">
        <Reveal>
          <p className="label-mono mb-4">Explorer · read-only</p>
          <h1 className="text-chrome max-w-[860px] text-[42px] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[64px]">See where a transaction passed or failed.</h1>
          <p className="mt-5 max-w-[640px] text-[16px] leading-relaxed text-muted-foreground">
            Follow a recorded incident, or paste a transaction hash to see what passed or failed. A rule contract address shows its settings.
          </p>
        </Reveal>

        {!initial && TRACES.length > 0 && <section className="mt-8" aria-label="Recorded incidents">
          <h2 className="mb-3 text-[16px] font-semibold">Recorded incidents and examples</h2>
          <div className="grid gap-3 sm:grid-cols-2">{TRACES.map((context) => <a key={context.id} href={href("explorer", "incident", context.id)} className="glass block rounded-2xl p-4 transition-colors hover:bg-foreground/[0.03]">
            <p className="text-[14px] font-semibold">{context.title} →</p><p className="mt-1 text-[12px] text-muted-foreground">{context.steps.length} explained transactions · {context.network === "devnet1" ? "public" : "local"} devnet</p>
          </a>)}</div>
        </section>}

        <Reveal delay={0.1} className="mt-8">
          <form
            onSubmit={(e) => (e.preventDefault(), submit())}
            className="glass-strong flex flex-col gap-2 rounded-[28px] p-2 sm:flex-row sm:items-center"
          >
            <Select value={devnet} onValueChange={(v) => (setDevnet(v as DevnetName), setRes(null), setAdm(null))}>
              <SelectTrigger className="h-12 rounded-full border-[var(--glass-border)] bg-transparent px-4 font-mono text-[12px] sm:w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass-strong">
                <SelectItem value="local">local · chain 1338</SelectItem>
                <SelectItem value="devnet1">public devnet · chain 1337</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-1 items-center gap-2 rounded-full border border-[var(--glass-border)] bg-background/40 pl-4">
              <Search className="size-4 shrink-0 text-faint" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="0x… transaction hash, or a rule contract address"
                spellCheck={false}
                className="h-12 min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-faint"
              />
            </div>
            <button disabled={!q || busy} className="btn-solid flex h-12 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[13px] font-medium text-background disabled:opacity-30 disabled:shadow-none">
              {busy && <Loader2 className="size-4 animate-spin" />} Inspect
            </button>
          </form>
          <details className="mt-3 px-2 font-mono text-[11px] text-faint"><summary className="cursor-pointer">Network details</summary><div className="mt-2 flex flex-wrap gap-x-6 gap-y-1"><span>rpc {d.rpcUrl}</span><span>sidecar {d.sidecarUrl}</span><span>factory 0x1edd…8380</span></div></details>
        </Reveal>

        <AnimatePresence mode="wait">
          {res && (
            <motion.div key={JSON.stringify(res, (_, v) => (typeof v === "bigint" ? v.toString() : v))} initial={{ opacity: 0, y: 12, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0 }} className="mt-10">
              <Result r={res} devnet={devnet} />
            </motion.div>
          )}
        </AnimatePresence>

        {!initial && <>
        {/* recent admissions: every one opens in the inspector */}
        <section className="mt-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label-mono mb-3">Recent transactions</p>
              <h2 className="text-[24px] font-semibold tracking-tight">Admitted and refused, straight from the sidecar.</h2>
              <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-muted-foreground">
                The sidecar keeps what it holds in memory (<code className="font-mono">skandha_explorer_listAdmissions</code>). Click a row to see its flow.
              </p>
            </div>
            <button
              onClick={async () => {
                try {
                  setAdm({ ok: true, rows: await listAdmissions(devnet) });
                } catch (e) {
                  setAdm({ ok: false, error: e instanceof Error ? e.message : String(e) });
                }
              }}
              className="glass h-10 rounded-full px-5 text-[13px] text-muted-foreground hover:text-foreground"
            >
              Load from {devnet}
            </button>
          </div>
          <div className="glass mt-6 min-h-[120px] overflow-hidden rounded-[24px]">
            {!adm && <p className="p-5 font-mono text-[12px] text-faint">Nothing loaded yet.</p>}
            {adm && !adm.ok && <p className="p-5 font-mono text-[12px]">✕ {adm.error}. The sidecar needs its explorer enabled and CORS for this origin; the local devnet's sidecar serves both.</p>}
            {adm?.ok && (
              <div className="max-h-[420px] divide-y divide-[var(--glass-border)] overflow-auto">
                {adm.rows.length === 0 && <p className="p-5 font-mono text-[12px] text-faint">The sidecar holds no transactions right now.</p>}
                {[...adm.rows].sort((x, y) => y.at - x.at).map((r) => {
                  const failed = r.checks?.find((c) => c.verdict === "fail");
                  return (
                    <button key={r.txHash + r.at} onClick={() => (setQ(r.txHash), go("explorer", devnet, r.txHash))} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-3 text-left font-mono text-[12px] hover:bg-foreground/[0.03]">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10.5px]", r.outcome === "rejected" ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400")}>{r.outcome}</span>
                      <span className="min-w-0 truncate text-foreground/90">
                        {r.txHash.slice(0, 18)}…{r.txHash.slice(-6)} <span className="text-faint">· sender {r.sender.slice(0, 8)}…</span>
                        {failed && <span className="block truncate text-[11px] text-muted-foreground">{failed.rule}: {failed.detail}</span>}
                      </span>
                      <span className="text-faint">{new Date(r.at).toLocaleTimeString()}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="mt-16 grid gap-4 md:grid-cols-2">
          <div className="glass rounded-[24px] p-6">
            <p className="label-mono">Live status</p>
            <p className="mt-3 text-[14px] leading-relaxed text-foreground/85">
              Whether a trigger would be accepted right now, with the reason when it would not: the SDK's <code className="font-mono text-[12px]">canTrigger</code> and <code className="font-mono text-[12px]">simulate</code>. In the browser once the SDK ships a browser build; today, from the CLI:
            </p>
            <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-[var(--glass-border)] px-3 py-2 font-mono text-[11.5px] text-muted-foreground">
              <span className="truncate">bun packages/sdk/bin/popcorn-simulate.ts {res?.kind === "rule" ? res.address : "<rule contract>"} --devnet {devnet}</span>
              <SnippetCopyButton className="size-7 shrink-0 opacity-100" value={`bun packages/sdk/bin/popcorn-simulate.ts ${res?.kind === "rule" ? res.address : "<rule contract>"} --devnet ${devnet}`} />
            </div>
          </div>
          <div className="glass rounded-[24px] p-6">
            <p className="label-mono">Budgets on {d.name}</p>
            <div className="mt-4 space-y-2 font-mono text-[12px]">
              <Row k="ethrex (public mempool)" v={d.budgets?.ethrex?.toLocaleString("en-US") ?? "unknown"} />
              <Row k="sidecar · unstaked" v={d.budgets?.sidecar?.unstaked?.toLocaleString("en-US") ?? "unknown"} />
              <Row k="sidecar · staked" v={d.budgets?.sidecar?.staked?.toLocaleString("en-US") ?? "unknown"} />
            </div>
            <p className="mt-4 text-[11.5px] leading-relaxed text-faint">From the SDK's devnet table.</p>
          </div>
        </section>
        </>}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--glass-border)] py-2 first:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right text-foreground">{v}</span>
    </div>
  );
}

function Addr({ a }: { a: string }) {
  const s = useScramble(a, true, 700);
  return <span className="break-all">{s}</span>;
}

function Result({ r, devnet }: { r: Lookup; devnet: DevnetName }) {
  if (r.kind === "error") return <div className="glass rounded-[24px] p-6 font-mono text-[12.5px]">✕ {r.message}</div>;
  if (r.kind === "other")
    return (
      <div className="glass rounded-[24px] p-6">
        <p className="label-mono">Not a Popcorn rule contract</p>
        <p className="mt-3 font-mono text-[13px]"><Addr a={r.address} /></p>
        <p className="mt-3 text-[13px] text-muted-foreground">{r.codeSize ? `${r.codeSize.toLocaleString("en-US")} bytes of code that is not Core followed by 101 argument bytes.` : "No code at this address."} Balance {formatEther(r.balance)} ETH.</p>
      </div>
    );
  if (r.kind === "tx") return <TxView ins={r.ins} devnet={devnet} recorded={r.recorded} />;
  const a = r.args;
  return (
    <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
      <div className="glass rounded-[24px] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="label-mono">Rule contract</p>
          <span className="rounded-full border border-[var(--glass-border)] px-2.5 py-1 font-mono text-[11px] text-muted-foreground" title={r.core === "unchecked" ? "Build Core (contracts/core/build.sh) before building the site to compare the code." : undefined}>
            Core {r.core === "match" ? "✓ pinned build" : "· build not compared"}
          </span>
        </div>
        <p className="mt-3 font-mono text-[13px]"><Addr a={r.address} /></p>
        <div className="mt-5 font-mono text-[12px]">
          <Row k="mode" v={a.mode === 0 ? "rule-pays" : "caller-pays"} />
          <Row k="logic" v={`${a.logic.slice(0, 10)}…${a.logic.slice(-6)}${r.logicHasCode ? "" : " (no code!)"}`} />
          <Row k="maxFeePerGas" v={`${a.maxFeePerGas.toLocaleString("en-US")} wei`} />
          <Row k="maxPriorityFeePerGas" v={`${a.maxPriorityFeePerGas.toLocaleString("en-US")} wei`} />
          <Row k="maxGasPerFrame" v={a.maxGasPerFrame.toLocaleString("en-US")} />
          <Row k="maxStateGasPerFrame" v={a.maxStateGasPerFrame.toLocaleString("en-US")} />
          <Row k="conditionGas" v={a.conditionGas.toLocaleString("en-US")} />
          <Row k="VERIFY floor at caps" v={(10_000 + a.conditionGas + Math.floor(a.conditionGas / 63) + 7_000 + a.maxVerifyDataLength + 68 + Math.ceil(a.maxTriggerDataLength / 32) * 32).toLocaleString("en-US")} />
          <Row k="max verifyData / triggerData" v={`${a.maxVerifyDataLength} / ${a.maxTriggerDataLength} bytes`} />
          <Row k="verifier" v={a.verifier === "0x0000000000000000000000000000000000000000" ? "none" : a.verifier} />
        </div>
      </div>
      <div className="space-y-4">
        <div className="glass rounded-[24px] p-6">
          <p className="label-mono">Balance</p>
          <p className="numeral-sheen mt-3 font-pixel text-[40px] leading-none">{Number(formatEther(r.balance)).toFixed(4)}</p>
          <p className="mt-1 font-mono text-[12px] text-muted-foreground">ETH{a.mode === 0 ? " · pays its own triggers" : ""}</p>
        </div>
        <div className="glass rounded-[24px] p-6">
          <p className="label-mono">Stake</p>
          <p className="mt-3 font-pixel text-[28px] leading-none">{r.stake === null ? "?" : r.stake > 0n ? formatEther(r.stake) : "0"}</p>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            {r.stake === null ? "Registry unreadable on this devnet." : r.stake > 0n ? "Staked: may read other contracts on the alternative mempool." : "Unstaked: own storage only, or the public mempool."}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------- a transaction, stage by stage and node by node */

const STAGE_TONE: Record<Stage["state"], string> = {
  pass: "border-emerald-500/60 bg-emerald-500/[0.08]",
  fail: "border-red-500/70 bg-red-500/[0.09]",
  skipped: "border-foreground/10 opacity-55",
  unknown: "border-dashed border-foreground/25",
};
const STAGE_MARK: Record<Stage["state"], string> = { pass: "✓", fail: "✕", skipped: "·", unknown: "?" };

function TxView({ ins, devnet, recorded = false }: { ins: Inspection; devnet: DevnetName; recorded?: boolean }) {
  const head =
    ins.status === "included" ? "Included" : ins.status === "refused" ? "Refused" : ins.status === "action-reverted" ? (ins.transaction ? "Transaction reverted on chain" : "Included with a revert") : ins.status === "pending" ? "Pending" : ins.status === "dropped" ? "Admitted, then dropped" : "Not found";
  const checks = ins.stages.find((s) => s.checks)?.checks;
  const saved = transactionsIn(ins.hash, devnet)[0]?.step;
  return (
    <div className="space-y-6">
      <TransactionContext inspection={ins} network={devnet} />
      {recorded && <p className="text-[12px] leading-relaxed text-muted-foreground">Showing saved evidence. The selected node or sidecar did not return this transaction; the recorded outcome has not been freshly verified.</p>}
      {saved?.outcome === "refused" && <p className="text-[12px] leading-relaxed text-muted-foreground">{recorded ? "Showing the saved refusal from the demo; the sidecar no longer holds this hash. The flow below is recorded evidence." : "The incident preserves the original refusal. Live condition checks below describe the current state; they can differ from the state when this attempt was refused."}</p>}
      <div className="glass rounded-[24px] p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className={cn("rounded-full px-3 py-1 font-mono text-[11px]", ins.status === "included" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : ins.status === "unknown" ? "bg-foreground/[0.06] text-muted-foreground" : "bg-red-500/15 text-red-600 dark:text-red-400")}>{recorded ? `Recorded: ${head}` : head}</span>
          {ins.flow && <span className="label-mono">trigger · {ins.flow.trigger}</span>}
        </div>
        <p className="mt-3 break-all font-mono text-[12.5px] text-foreground/90">{ins.hash}</p>
        <div className="mt-3 grid gap-x-8 gap-y-1 font-mono text-[11.5px] text-muted-foreground sm:grid-cols-2">
          {ins.build && <span className="break-all">{ins.triggerData !== null ? "build" : "account"} {ins.build}</span>}
          {ins.payer && <span className="break-all">payer {ins.payer}</span>}
          {ins.block !== null && <span>block {ins.block.toLocaleString("en-US")}</span>}
          {ins.seenAt !== null && <span>seen by the sidecar {new Date(ins.seenAt).toLocaleString()}</span>}
          <span>{recorded ? "from the saved recording" : "found on "}{!recorded && (ins.foundOn === "node" ? "the node" : ins.foundOn === "sidecar" ? "the sidecar" : "neither")}</span>
        </div>
      </div>

      {ins.transaction && <section className="glass rounded-2xl p-5 text-[13px]">
        <h2 className="font-semibold">{ins.transaction.to === null ? "Contract deployment" : ins.transaction.input === "0x" ? "ETH transfer" : "Contract call"}</h2>
        <dl className="mt-3 space-y-2 text-muted-foreground"><div><dt>From</dt><dd className="break-all font-mono text-[12px]">{ins.transaction.from}</dd></div><div><dt>To</dt><dd className="break-all font-mono text-[12px]">{ins.transaction.to ?? "New contract"}</dd></div><div><dt>Value</dt><dd>{formatEther(BigInt(ins.transaction.value))} ETH</dd></div>{ins.transaction.input !== "0x" && <div><dt>Call data</dt><dd className="break-all font-mono text-[12px]">{ins.transaction.input.slice(0, 10)} · {(ins.transaction.input.length - 2) / 2} bytes</dd></div>}</dl>
        <p className="mt-3 text-[12px] text-muted-foreground">Ordinary transaction: no Popcorn validation frames were evaluated. A reverted on-chain call still uses gas.</p>
      </section>}
      {/* the stages, left to right */}
      <div className="flex flex-wrap items-stretch gap-2">
        {ins.stages.map((s, i) => (
          <div key={s.id + i} className="flex items-center gap-2">
            <div className={cn("w-[200px] rounded-2xl border px-3 py-2.5", STAGE_TONE[s.state])} title={s.detail}>
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
                {STAGE_MARK[s.state]} {s.state === "skipped" ? "not reached" : s.state}
              </p>
              <p className="mt-1 text-[13px] font-semibold tracking-tight">{s.title}</p>
              <p className="mt-0.5 line-clamp-3 text-[11.5px] leading-snug text-muted-foreground">{s.detail}</p>
            </div>
            {i < ins.stages.length - 1 && <span className="text-faint">→</span>}
          </div>
        ))}
      </div>

      {ins.refusal && (
        <p className="rounded-2xl border border-red-500/40 bg-red-500/[0.06] px-4 py-3 text-[13px] leading-relaxed">
          <span className="font-mono text-[11px] text-red-600 dark:text-red-400">frame {ins.refusal.frame} · {ins.refusal.who}</span> {ins.refusal.meaning}
        </p>
      )}

      {ins.flow ? (
        <div className="glass rounded-[24px] p-6">
          <p className="label-mono mb-4">The build's flow</p>
          <FlowGraph flow={ins.flow} />
          <FlowVerdict flow={ins.flow} recorded={recorded} />
        </div>
      ) : (
        !ins.transaction && <p className="text-[13px] text-muted-foreground">{saved ? "No condition flow was recorded for this step. Its role and related transactions are explained above." : "No Popcorn condition flow is available for this transaction."}</p>
      )}

      {checks && (
        <details className="glass rounded-[24px] p-6">
          <summary className="label-mono cursor-pointer">Every admission check</summary>
          <div className="mt-4 font-mono text-[12px]">
            {checks.map((c, i) => (
              <Row key={c.rule + i} k={c.rule} v={`${c.verdict}${c.detail ? ` · ${c.detail}` : ""}`} />
            ))}
          </div>
        </details>
      )}
      <a href={explorerTxUrl(ins.hash, devnet)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
        Open in the devnet's explorer <ArrowUpRight className="size-3.5" />
      </a>
    </div>
  );
}
