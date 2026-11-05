// Signed intent: the owner signs "add 5 to rule 0's counter" off-chain; ANYONE (here a client with no account and no ETH) submits it and
// the KERNEL pays. Nothing is sent by the signer, no gas is paid by the signer, and the signature works once: the rule contract moves to the next
// epoch when the trigger runs.
//   POPCORN_DEVNET=local POPCORN_KEY=devnet/keys/dev-5.json bun packages/sdk/examples/08-signed-intent.ts
import { createPublicClient, createWalletClient, encodeAbiParameters, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { deployCode, deployParamsBlob, ecdsaParams, intentDigest, popcorn, signEcdsaIntent } from "@popcorn/sdk";
import { artifact, chain, devnet, deployerAccount } from "./_common.ts";

const pub = createPublicClient({ chain, transport: http() });
const owner = deployerAccount(); // the key that signs intents (and, here, pays for the deployment)
const deployer = createWalletClient({ account: owner, chain, transport: http() }).extend(popcorn({ devnet }));

// 1. Deploy the stateless ECDSA predicate, a blob holding the signer's address, and a rule contract whose condition is "the signer signed this trigger".
const predicate = await deployCode({ wallet: deployer, pub }, artifact("EcdsaSigner").bytecode);
const blob = await deployParamsBlob({ wallet: deployer, pub }, ecdsaParams(owner.address));
const counter = artifact("SignedIntentCounter");
const { ruleContract } = await deployer.deployRule({
  logic: { abi: counter.abi, bytecode: counter.bytecode, args: [predicate.address, blob.address] },
  caps: { conditionGas: 60_000, maxVerifyDataLength: 65, maxTriggerDataLength: 64 },
  fund: parseEther("0.2"),
});
console.log("rule contract", ruleContract);

// 2. Sign off-chain: rule 0, epoch 0 (the rule contract's first), triggerData = (ruleId 0, amount 5). The digest binds chain, rule contract, rule, epoch and triggerData.
const triggerData = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [0n, 5n]);
const binding = { chainId: BigInt(chain.id), ruleContract, ruleId: 0n, ruleEpoch: 0n, triggerData };
console.log("digest", intentDigest(binding));
const signature = await signEcdsaIntent(owner, binding);

// 3. Anyone submits it: a fresh key that never held ETH. The signature travels in the trigger's verifyData.
const triggerer = createWalletClient({ account: privateKeyToAccount(generatePrivateKey()), chain, transport: http() }).extend(popcorn({ devnet }));
const hash = await triggerer.trigger(ruleContract, { triggerData, verifyData: signature });
const status = await triggerer.watch(hash);
console.log("trigger", hash, status.state, triggerer.explorerUrl(hash));
console.log("triggerer balance", await pub.getBalance({ address: triggerer.account.address }));
console.log("total(rule 0) =", await pub.readContract({ address: ruleContract, abi: counter.abi, functionName: "total", args: [0n] }));

// 4. The same signed intent again is refused: the rule contract now asks for epoch 1.
const again = await triggerer.canTrigger(ruleContract, { triggerData, verifyData: signature });
console.log("replay:", again.name);
