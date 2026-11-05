// Hybrid owner (ECDSA + WOTS+): owner-only calls on a rule contract, signed by both. The owner keys and the one-time-leaf counter
// live in files you choose (git-ignored keys/ here); the counter must persist.
//   POPCORN_DEVNET=local bun packages/sdk/examples/03-owner.ts
import { existsSync, mkdirSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseEther } from "viem";
import { generateHybridKeys, loadHybridSigner, popcorn } from "@popcorn/sdk";
import { artifact, chain, devnet, devnetName, deployerAccount } from "./_common.ts";

const counter = artifact("ArmedCounter");
const pub = createPublicClient({ chain, transport: http() });

// 1. Owner keys: generated once (about 7 s for the WOTS+ tree), stored 0600, the leaf counter next to them (<file>.leaves).
mkdirSync("keys", { recursive: true });
const keyFile = `keys/example-owner-${devnetName}.json`;
const signer = existsSync(keyFile) ? loadHybridSigner(keyFile) : generateHybridKeys(keyFile).signer;
console.log("owner ecdsa", signer.address, "next one-time leaf", signer.nextLeaf());

// 2. Deploy the rule contract WITH the owner: the factory writes the ECDSA address, WOTS root and public seed into Core's slots.
const w = createWalletClient({ account: deployerAccount(), chain, transport: http() }).extend(popcorn({ devnet }));
const { ruleContract } = await w.deployRule({ logic: { bytecode: counter.bytecode }, fund: parseEther("0.05"), owner: signer.ownerInit() });
console.log("rule contract", ruleContract, await w.readOwnerState(ruleContract));

// 3. An owner action: setLimit(5) is `onlyOwnerCall`, so a normal transaction reverts and only this path can run it.
//    ownerAction builds the frame tx, simulates it, signs ONCE (spends a leaf), re-simulates, sends and waits.
const call = encodeFunctionData({ abi: counter.abi, functionName: "setLimit", args: [5n] });
const r = await w.ownerAction(ruleContract, call, signer);
console.log("owner tx", r.hash, "leaf", r.leaf, "call succeeded:", r.callSucceeded, w.explorerUrl(r.hash));
console.log("limit =", await pub.readContract({ address: ruleContract, abi: counter.abi, functionName: "limit" }));
