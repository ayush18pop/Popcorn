// Caller-pays (Core mode 1): a payer (any funded wallet) pays the gas for the trigger and the rule contract pays it a reward.
//   POPCORN_DEVNET=local bun packages/sdk/examples/02-caller-pays.ts
//   POPCORN_PAYER_KEY=devnet/keys/dev-2.json   (optional: a different wallet as the payer; default = the deployer)
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { popcorn } from "@popcorn/sdk";
import { artifact, chain, devnet, deployerAccount, loadAccount } from "./_common.ts";

const paid = artifact("PaidCounter");
const pub = createPublicClient({ chain, transport: http() });
const deployerAcct = deployerAccount();
const payer = process.env.POPCORN_PAYER_KEY ? loadAccount(process.env.POPCORN_PAYER_KEY) : deployerAcct;

const deployer = createWalletClient({ account: deployerAcct, chain, transport: http() }).extend(popcorn({ devnet }));
const reward = parseEther("0.001");
const { ruleContract } = await deployer.deployRule({
  logic: { abi: paid.abi, bytecode: paid.bytecode, args: [reward] },
  mode: "callerPays", // fee caps are 0 and the rule contract needs no gas money, only the reward money below
  fund: parseEther("0.01"),
  allowUnderfunded: true,
});
console.log("caller-pays rule contract", ruleContract);

const armTx = await deployer.writeContract({ address: ruleContract, abi: paid.abi, functionName: "arm", gas: 300_000n });
await pub.waitForTransactionReceipt({ hash: armTx });

// The payer is REQUIRED in mode 1: an account that signs its VERIFY frame (here), or a payer contract's address.
const client = createPublicClient({ chain, transport: http() }).extend(popcorn({ devnet }));
const ready = await client.canTrigger(ruleContract, { payer });
console.log("ready:", ready.name);

// Optional tail: a DEFAULT frame after the action that belongs to the payer (never the rule contract). A trade, a swap, a sweep...
const tail = { target: payer.address, data: "0x" as const, gasLimit: 30_000n };
const before = await pub.getBalance({ address: payer.address });
const hash = await client.trigger(ruleContract, { payer, tail });
const status = await client.watch(hash);
const after = await pub.getBalance({ address: payer.address });
console.log("trigger", hash, status.state, "payer balance change (wei, gas paid and reward received):", after - before);
