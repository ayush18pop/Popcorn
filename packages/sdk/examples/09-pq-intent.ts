// A post-quantum signed intent: a WOTS+ tree signs the trigger off-chain, anyone submits it, the rule contract pays. The rule contract uses the INLINE trigger
// (WotsIntentCounter: key in immutables, no predicate call), the version that fits the public 100k budget once the signer grinds the salt.
// WOTS+ is one-time per leaf: the signer persists which digest each leaf signed BEFORE it returns a signature and refuses a second digest.
//   POPCORN_DEVNET=local POPCORN_KEY=devnet/keys/dev-5.json bun packages/sdk/examples/09-pq-intent.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeDeployData, http, parseEther } from "viem";
import { deployCode, fileUsageStore, intentDigest, popcorn, wotsIntentKey, wotsIntentSigner, wotsKeygen } from "@popcorn/sdk";
import { artifact, chain, devnet, deployerAccount } from "./_common.ts";

const pub = createPublicClient({ chain, transport: http() });
const deployer = createWalletClient({ account: deployerAccount(), chain, transport: http() }).extend(popcorn({ devnet }));

// 1. Keys. skSeed is secret (it regenerates every one-time key); pubSeed and the Merkle root are public. Leaf = ruleEpoch - firstEpoch.
//    The on-chain key is bound to ONE chain and ONE rule (here chain id and rule 0): the rule contract refuses any other rule. Never use the Core owner's WOTS+ tree here.
const tree = wotsKeygen(`0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`); // demo seeds: use random ones and keep skSeed private
const key = wotsIntentKey(tree, 0, chain.id, 0);

// 2. A rule contract whose condition is "this tree signed this trigger for rule 0".
const counter = artifact("WotsIntentCounter", "IntentCounters");
const logic = await deployCode(
  { wallet: deployer, pub },
  encodeDeployData({ abi: counter.abi, bytecode: counter.bytecode, args: [key.root, key.pubSeed, 0n, BigInt(chain.id), 0n] }),
  24_000_000n,
);
const { ruleContract } = await deployer.deployRule({
  logic: logic.address,
  caps: { conditionGas: 72_000, maxVerifyDataLength: 2496, maxTriggerDataLength: 64 },
  fund: parseEther("0.2"),
});

// The signer is bound to this one (chain, rule contract, rule) and needs a step budget: it grinds the salt until the verifier needs at most maxSteps hash steps
// (about 117 gas each; a few seconds) and THROWS, spending no leaf, if none fits. A signed one-time intent must be executed: its leaf is spent when it is signed.
const signer = wotsIntentSigner({
  tree,
  firstEpoch: 0,
  binding: { chainId: BigInt(chain.id), ruleContract, ruleId: 0n },
  store: fileUsageStore(`${mkdtempSync(`${tmpdir()}/wots-`)}/leaves.json`), // required: a restart must not forget spent leaves
  budget: { maxSteps: 380, maxTries: 3_000_000 },
});

// 3. Sign epoch 0 of rule 0 off-chain, then anyone triggers it. The declared VERIFY limit is used gas + 1,500 so the trigger stays under 100k.
const triggerData = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [0n, 5n]);
const binding = { chainId: BigInt(chain.id), ruleContract, ruleId: 0n, ruleEpoch: 0n, triggerData };
const witness = signer.sign(binding);
const triggerer = createPublicClient({ chain, transport: http() }).extend(popcorn({ devnet }));
const ready = await triggerer.canTrigger(ruleContract, { triggerData, verifyData: witness });
const hash = await triggerer.trigger(ruleContract, { triggerData, verifyData: witness, verifyGasLimit: (ready.simulation.frames?.[0]?.gasUsed ?? 90_000n) + 1_500n });
console.log("digest", intentDigest(binding));
console.log("trigger", hash, (await triggerer.watch(hash)).state);
