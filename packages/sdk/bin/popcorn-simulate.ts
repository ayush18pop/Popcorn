#!/usr/bin/env bun
// popcorn-simulate: would this rule contract's trigger be accepted, by the public mempool and by the alt mempool? Plain English.
//
//   bunx popcorn-simulate <rule contract> [--devnet local|devnet1] [--trigger-args 0x..] [--verify-data 0x..]
//                         [--payer <addr>] [--payer-key-file <keys.json>] [--sidecar-admit] [--json]
//
// Sends NOTHING by default: ethrex simulates the trigger, and the alt-mempool verdict is predicted from that, the rule contract's
// stake and the budgets ("predicted: ..."). Exit code 0 both mempools accept, 1 at least one rejects, 2 usage / network error.
//   --sidecar-admit   ALSO ask the sidecar for its own verdict. THIS SUBMITS THE POP (eth_sendFrameTransaction); the local
//                     devnet's sidecar auto-bundles, so an admitted trigger is INCLUDED FOR REAL. The sidecar has no read-only
//                     validate (eth_estimateFrameTransactionGas always fails with Core 0x15).
//   --payer           caller-pays rule contracts: the payer. A contract address needs no key; an EOA needs its key, from
//                     --payer-key-file (the repo's keys/*.json format) or the POPCORN_PAYER_KEY environment variable.
//   --json            print { rule contract, devnet, network, stake, balances, report } as JSON instead of text.
import { readFileSync } from "node:fs";
import { createPublicClient, getAddress, http, isAddress, isHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { devnetChain, popcorn, toJSON } from "../src/index.ts";

const USAGE = "usage: popcorn-simulate <rule contract> [--devnet local|devnet1] [--trigger-args 0x..] [--verify-data 0x..] [--payer <addr>] [--payer-key-file <file>] [--sidecar-admit] [--json]";
const fail = (msg: string, code = 2): never => {
  console.error(msg);
  process.exit(code);
};

const argv = process.argv.slice(2);
const flags: Record<string, string | true> = {};
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (!a.startsWith("--")) pos.push(a);
  else if (["--json", "--sidecar-admit", "--help"].includes(a)) flags[a] = true;
  else {
    const v = argv[++i];
    if (v === undefined) fail(`${a} needs a value\n${USAGE}`);
    flags[a] = v!;
  }
}
if (flags["--help"] || pos.length !== 1) fail(USAGE, flags["--help"] ? 0 : 2);
const ruleContract = pos[0]!;
if (!isAddress(ruleContract)) fail(`not an address: ${ruleContract}`);
const devnetArg = (flags["--devnet"] as string | undefined) ?? process.env.POPCORN_DEVNET ?? "devnet1";
if (devnetArg !== "local" && devnetArg !== "devnet1") fail(`--devnet must be local or devnet1, got ${devnetArg}`);
const devnet = devnetArg as "local" | "devnet1";
const hexFlag = (name: string): Hex | undefined => {
  const v = flags[name];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !isHex(v)) fail(`${name} must be 0x-hex`);
  return v as Hex;
};

const chain = devnetChain(devnet);
const client = createPublicClient({ chain, transport: http() }).extend(popcorn({ devnet, sidecar: !!flags["--sidecar-admit"] }));

let payer: Address | ReturnType<typeof privateKeyToAccount> | undefined;
const payerFlag = flags["--payer"];
if (typeof payerFlag === "string") {
  if (!isAddress(payerFlag)) fail(`--payer: not an address: ${payerFlag}`);
  const keyFile = flags["--payer-key-file"];
  const keyEnv = process.env.POPCORN_PAYER_KEY;
  if (typeof keyFile === "string" || keyEnv) {
    const key = (keyEnv ?? (JSON.parse(readFileSync(keyFile as string, "utf8")) as { private_key: Hex }[])[0]!.private_key) as Hex;
    const acct = privateKeyToAccount(key);
    if (acct.address.toLowerCase() !== payerFlag.toLowerCase()) fail(`the payer key is for ${acct.address}, not ${payerFlag}`);
    payer = acct;
  } else payer = getAddress(payerFlag);
}

try {
  const r = await client.simulate(getAddress(ruleContract), {
    ...(hexFlag("--trigger-args") ? { triggerData: hexFlag("--trigger-args")! } : {}),
    ...(hexFlag("--verify-data") ? { verifyData: hexFlag("--verify-data")! } : {}),
    ...(payer ? { payer } : {}),
  });
  const wei = (n: bigint | null) => (n === null ? null : n.toString());
  if (flags["--json"]) {
    console.log(
      JSON.stringify(
        {
          ruleContract: getAddress(ruleContract), devnet, network: r.network, hash: r.hash,
          verifyGasLimit: wei(r.verifyGasLimit), verifyGasUsed: wei(r.ethrex.verifyGas), prefixGas: wei(r.prefixGas),
          ruleContractBalance: wei(r.ruleContractBalance), maxCost: wei(r.maxCost), minOperatingBalance: wei(r.minOperatingBalance),
          payer: r.payer, payerBalance: wei(r.payerBalance),
          stake: r.stake ? { registry: r.stake.registry, stake: String(r.stake.stake), isStaked: r.stake.isStaked } : null,
          report: JSON.parse(toJSON(r.report)),
        },
        null,
        2,
      ),
    );
  } else {
    const stake = r.stake ? (r.stake.isStaked ? `staked (${r.stake.stake} wei)` : "not staked") : "stake unknown";
    console.log(`rule contract ${getAddress(ruleContract)} on ${devnet}: VERIFY used ${r.ethrex.verifyGas ?? "n/a"} gas (declared ${r.verifyGasLimit}), ${stake}`);
    console.log(r.text);
  }
  if (flags["--sidecar-admit"] && !flags["--json"]) console.error("WARNING: --sidecar-admit submitted this trigger to the sidecar. An auto-bundling sidecar (the local devnet's) may have included it for real; the same trigger-args then show 'already included'.");
  process.exit(r.report.publicMempool.ok === true && r.report.altMempool.ok !== false ? 0 : 1);
} catch (e) {
  fail(`popcorn-simulate: ${e instanceof Error ? e.message : String(e)}`);
}
