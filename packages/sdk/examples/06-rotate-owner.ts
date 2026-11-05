// Owner rotation is TWO steps, so a typo'd root or an uncontrolled key can never lock you out:
//   1. the current owner stages the new owner (ownerRotate);  2. the NEW owner's keys sign ownerFinalizeRotation().
// Run after 03-owner.ts's setup, or alone (it deploys its own rule contract).  POPCORN_DEVNET=local bun packages/sdk/examples/06-rotate-owner.ts
import { mkdirSync } from "node:fs";
import { createWalletClient, encodeFunctionData, http, parseEther } from "viem";
import { generateHybridKeys, popcorn } from "@popcorn/sdk";
import { artifact, chain, devnet, devnetName, deployerAccount } from "./_common.ts";

const counter = artifact("ArmedCounter");
mkdirSync("keys", { recursive: true });
const stamp = Date.now();
const current = generateHybridKeys(`keys/example-rotate-a-${devnetName}-${stamp}.json`).signer;
const next = generateHybridKeys(`keys/example-rotate-b-${devnetName}-${stamp}.json`).signer; // a FRESH tree: never reuse one

const w = createWalletClient({ account: deployerAccount(), chain, transport: http() }).extend(popcorn({ devnet }));
const { ruleContract } = await w.deployRule({ logic: { bytecode: counter.bytecode }, fund: parseEther("0.05"), owner: current.ownerInit() });

// 1. Stage. The old keys stay valid until step 2 succeeds. (A new tree's first slots are fresh storage: give the call more state gas.)
const stage = await w.ownerAction(ruleContract, encodeFunctionData({ abi: counter.abi, functionName: "ownerRotate", args: [next.address, next.wotsRoot, next.wotsPubSeed] }), current, { callStateGasLimit: 400_000n });
console.log("staged:", stage.callSucceeded, (await w.readOwnerState(ruleContract)).pending);

// 2. Finalize with the NEW signer. Core checks this one call against the staged keys.
const fin = await w.ownerAction(ruleContract, encodeFunctionData({ abi: counter.abi, functionName: "ownerFinalizeRotation" }), next);
const now = await w.readOwnerState(ruleContract);
console.log("finalized:", fin.callSucceeded, "owner is now", now.ecdsa, "root matches:", now.wotsRoot === next.wotsRoot);
// Remember: add the OLD root to the new key file's retiredRoots so the SDK refuses to ever rotate back to it.
