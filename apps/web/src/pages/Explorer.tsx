import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Loader2, Search } from "lucide-react";
import { formatEther, getAddress, isAddress, isHash, type Address, type Hex } from "viem";
import { devnets, explorerTxUrl, getAdmissionStatus, getReceipt, rpcRequest, type DevnetName } from "@popcorn/sdk/transport";
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
  | { kind: "tx"; hash: Hex; receipt: Awaited<ReturnType<typeof getReceipt>>; admission: Awaited<ReturnType<typeof getAdmissionStatus>> | null }
  | { kind: "error"; message: string };

async function lookup(devnet: DevnetName, q: string): Promise<Lookup> {
  const d = devnets[devnet];
  try {
    if (isHash(q)) {
      const [receipt, admission] = await Promise.all([
        getReceipt(q as Hex, { devnet }).catch(() => null),
        getAdmissionStatus(q as Hex, d.sidecarUrl).catch(() => null),
      ]);
      return { kind: "tx", hash: q as Hex, receipt, admission };
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

async function listAdmissions(devnet: DevnetName) {
  const d = devnets[devnet];
  return rpcRequest<unknown>(d.sidecarUrl, "skandha_explorer_listAdmissions", [{ limit: 20 }]);
}

export default function Explorer() {
  const [devnet, setDevnet] = useState<DevnetName>("local");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Lookup | null>(null);
  const [adm, setAdm] = useState<{ ok: boolean; data: unknown } | null>(null);
  const d = devnets[devnet];

  const submit = async () => {
    setBusy(true);
    setRes(await lookup(devnet, q.trim()));
    setBusy(false);
  };

  return (
    <div className="relative overflow-x-clip">
      <div className="hatch pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
      <div className="relative mx-auto max-w-[1120px] px-4 pb-32 pt-36 sm:px-6">
        <Reveal>
          <p className="label-mono mb-4">Explorer · read-only</p>
          <h1 className="text-chrome max-w-[860px] text-[42px] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[64px]">Look inside a rule contract.</h1>
          <p className="mt-5 max-w-[600px] text-[16px] leading-relaxed text-muted-foreground">
            Reads a devnet directly from your browser: a rule contract's settings, balance and stake, or a trigger's receipt and admission. It never signs or sends anything.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="mt-10">
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
                placeholder="0x… rule contract address or transaction hash"
                spellCheck={false}
                className="h-12 min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-faint"
              />
            </div>
            <button disabled={!q || busy} className="btn-solid flex h-12 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[13px] font-medium text-background disabled:opacity-30 disabled:shadow-none">
              {busy && <Loader2 className="size-4 animate-spin" />} Read
            </button>
          </form>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 px-2 font-mono text-[11px] text-faint">
            <span>rpc {d.rpcUrl}</span>
            <span>sidecar {d.sidecarUrl}</span>
            <span>factory 0x1edd…8380</span>
          </div>
        </Reveal>

        <AnimatePresence mode="wait">
          {res && (
            <motion.div key={JSON.stringify(res, (_, v) => (typeof v === "bigint" ? v.toString() : v))} initial={{ opacity: 0, y: 12, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0 }} className="mt-10">
              <Result r={res} devnet={devnet} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* triggers */}
        <section className="mt-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label-mono mb-3">Recent triggers</p>
              <h2 className="text-[24px] font-semibold tracking-tight">Admissions, rule by rule.</h2>
              <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-muted-foreground">
                From the sidecar's <code className="font-mono">skandha_explorer_listAdmissions</code>. It keeps only what it holds in memory, so a missing trigger does not mean it never happened: check the receipt above.
              </p>
            </div>
            <button
              onClick={async () => {
                try {
                  setAdm({ ok: true, data: await listAdmissions(devnet) });
                } catch (e) {
                  setAdm({ ok: false, data: e instanceof Error ? e.message : String(e) });
                }
              }}
              className="glass h-10 rounded-full px-5 text-[13px] text-muted-foreground hover:text-foreground"
            >
              Load from {devnet}
            </button>
          </div>
          <div className="glass mt-6 min-h-[120px] overflow-hidden rounded-[24px]">
            {adm ? (
              <pre className={cn("max-h-[420px] overflow-auto p-5 font-mono text-[11.5px] leading-relaxed", adm.ok ? "text-muted-foreground" : "text-foreground")}>
                {adm.ok ? JSON.stringify(adm.data, null, 2) : `✕ ${adm.data}\n\nThe sidecar needs its explorer enabled and CORS for this origin; the local devnet's sidecar serves both.`}
              </pre>
            ) : (
              <p className="p-5 font-mono text-[12px] text-faint">Nothing loaded yet.</p>
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
  if (r.kind === "tx")
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="glass rounded-[24px] p-6">
          <p className="label-mono">Receipt · from the chain</p>
          {r.receipt ? (
            <div className="mt-4 font-mono text-[12px]">
              <Row k="status" v={String((r.receipt as { status?: unknown }).status ?? "—")} />
              <Row k="block" v={String((r.receipt as { blockNumber?: unknown }).blockNumber ?? "—")} />
              <Row k="gas used" v={String((r.receipt as { gasUsed?: unknown }).gasUsed ?? "—")} />
              <Row k="payer" v={String((r.receipt as { payer?: unknown }).payer ?? "—")} />
            </div>
          ) : (
            <p className="mt-4 text-[13px] text-muted-foreground">No receipt yet: not included, or not on this devnet.</p>
          )}
        </div>
        <div className="glass rounded-[24px] p-6">
          <p className="label-mono">Admission · from the sidecar</p>
          <div className="mt-4 font-mono text-[12px]">
            <Row k="known" v={r.admission ? String(r.admission.known) : "unreachable"} />
            <Row k="outcome" v={r.admission?.outcome ?? "—"} />
            <Row k="reason" v={r.admission?.reason ?? "—"} />
          </div>
          <a href={explorerTxUrl(r.hash, devnet)} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
            Open in the devnet's explorer <ArrowUpRight className="size-3.5" />
          </a>
        </div>
      </div>
    );
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
