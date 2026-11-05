// Shared by the examples: which devnet, which key, and the forge artifacts. Run from the repo root after `bun run build`.
//   POPCORN_DEVNET=local bun packages/sdk/examples/01-rule-pays.ts
//   POPCORN_DEVNET=devnet1 POPCORN_KEY=keys/deployer.json bun packages/sdk/examples/01-rule-pays.ts
import { existsSync, readFileSync } from "node:fs";
import type { Abi, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { devnetChain, getDevnet, type DevnetName } from "@popcorn/sdk";

const ROOT = new URL("../../../", import.meta.url).pathname;

export const devnetName = (process.env.POPCORN_DEVNET ?? "devnet1") as DevnetName;
export const devnet = getDevnet(devnetName);
export const chain = devnetChain(devnetName);

/** A key file in the repo's `[{ address, private_key }]` format (git-ignored). Never printed. */
export function loadAccount(file?: string) {
  const path = file ?? (devnetName === "local" ? `${ROOT}devnet/keys/dev-7.json` : `${ROOT}keys/deployer.json`);
  if (!existsSync(path)) {
    throw new Error(`key file ${path} not found. Local devnet: run devnet/up.sh (it writes devnet/keys/dev-*.json). Public devnet: scripts/new-key.sh deployer, then scripts/faucet.sh keys/deployer.json. Or set POPCORN_KEY.`);
  }
  const entry = (JSON.parse(readFileSync(path, "utf8")) as { private_key: Hex }[])[0];
  if (!entry) throw new Error(`${path} has no key`);
  return privateKeyToAccount(entry.private_key);
}
export const deployerAccount = () => loadAccount(process.env.POPCORN_KEY);

/** abi + creation bytecode of a contract that `forge build` put in contracts/out (`file`: the .sol file name when it differs from the contract's). */
export function artifact(name: string, file = name): { abi: Abi; bytecode: Hex } {
  const path = `${ROOT}contracts/out/${file}.sol/${name}.json`;
  if (!existsSync(path)) throw new Error(`${path} not found: run \`bun run build\` first`);
  const j = JSON.parse(readFileSync(path, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: j.abi, bytecode: j.bytecode.object };
}
