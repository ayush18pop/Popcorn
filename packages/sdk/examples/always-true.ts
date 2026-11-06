// The smallest possible Popcorn: deploy AlwaysTrueRule (test logic: every distinct triggerData triggers once) and trigger it from a
// client with no account and no ETH. Run from the repo root after `bun run build`:
//   POPCORN_DEVNET=local bun packages/sdk/examples/always-true.ts            (local devnet, key devnet/keys/dev-7.json)
//   POPCORN_KEY=keys/deployer.json bun packages/sdk/examples/always-true.ts      (public devnet1)
import { createPublicClient, createWalletClient, http, parseEther, toHex } from "viem";
import { popcorn } from "@popcorn/sdk";
import { artifact, chain, devnet, deployerAccount } from "./_common.ts";

const deployer = createWalletClient({ account: deployerAccount(), chain, transport: http() }).extend(popcorn({ devnet }));
const { ruleContract, txHash } = await deployer.deployRule({ logic: { bytecode: artifact("AlwaysTrueRule").bytecode }, fund: parseEther("0.01") });

const triggerer = createPublicClient({ chain, transport: http() }).extend(popcorn({ devnet })); // no account, no ETH
const hash = await triggerer.trigger(ruleContract, { triggerData: toHex(`hello popcorn ${Date.now()}`) });
const status = await triggerer.watch(hash);
console.log(JSON.stringify({ ruleContract, createTx: txHash, trigger: hash, state: status.state, link: triggerer.explorerUrl(hash) }));
