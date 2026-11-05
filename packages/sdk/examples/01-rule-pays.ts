// Rule-pays: deploy ArmedCounter, watch it become ready, trigger it from a client with NO account and NO ETH.
//   POPCORN_DEVNET=local bun packages/sdk/examples/01-rule-pays.ts
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { popcorn } from "@popcorn/sdk";
import { artifact, chain, devnet, deployerAccount } from "./_common.ts";

const counter = artifact("ArmedCounter");
const pub = createPublicClient({ chain, transport: http() });

// 1. The deployer (needs ETH) deploys the logic and a rule contract through the factory, and funds the rule contract: the rule contract pays for triggers.
const deployer = createWalletClient({ account: deployerAccount(), chain, transport: http() }).extend(popcorn({ devnet }));
const { ruleContract, txHash } = await deployer.deployRule({ logic: { bytecode: counter.bytecode }, fund: parseEther("0.01") });
console.log("rule contract", ruleContract, "created by", txHash);

// 2. A client with no account: this is all a triggerer needs.
const triggerer = createPublicClient({ chain, transport: http() }).extend(popcorn({ devnet }));
const before = await triggerer.canTrigger(ruleContract);
console.log("before arm():", before.name); // CONDITION_FALSE (Core 0x22)

// 3. An ordinary transaction to the rule contract address is forwarded to the logic: anyone can arm it.
const armTx = await deployer.writeContract({ address: ruleContract, abi: counter.abi, functionName: "arm", gas: 300_000n });
await pub.waitForTransactionReceipt({ hash: armTx });

// 4. Ready now: trigger (nothing to sign, the rule contract pays) and follow the transaction until it is included.
const after = await triggerer.canTrigger(ruleContract);
console.log("after arm():", after.name); // READY
const hash = await triggerer.trigger(ruleContract);
const status = await triggerer.watch(hash);
console.log("trigger", hash, status.state, triggerer.explorerUrl(hash));
console.log("count =", await pub.readContract({ address: ruleContract, abi: counter.abi, functionName: "count" }));
