// Rule sets: an if/else rule set built from data, with no Solidity, deployed and triggered rule by rule.
//   POPCORN_DEVNET=local POPCORN_KEY=devnet/keys/dev-4.json bun packages/sdk/examples/07-rule-set.ts
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { sendTransaction, waitForTransactionReceipt } from "viem/actions";
import { deployRuleSet, explainRule, popcorn, ruleset } from "@popcorn/sdk";
import { artifact, chain, devnet, deployerAccount } from "./_common.ts";

const { above, always, getter, triggerDataFor, ruleSet } = ruleset;
const mock = artifact("MockValue");
const pub = createPublicClient({ chain, transport: http() });
const w = createWalletClient({ account: deployerAccount(), chain, transport: http() }).extend(popcorn({ devnet }));

// 1. A number to watch: MockValue.value(), which anyone can set.
const deployed = await sendTransaction(w, { data: mock.bytecode, gas: 1_000_000n } as never);
const gauge = (await waitForTransactionReceipt(pub, { hash: deployed })).contractAddress!;
const setValue = async (v: bigint) => waitForTransactionReceipt(pub, { hash: await w.writeContract({ address: gauge, abi: mock.abi, functionName: "set", args: [v], gas: 500_000n }) });

// 2. Three rules in "else" order: a rule fires only when its condition is true and every rule before it is false.
//    Each rule fires once (maxFires defaults to 1) and has its own nonce key.
const reading = getter(gauge, "value()");
const rules = ruleSet(
  "else",
  { name: "high", when: above(reading, 100n) },
  { name: "medium", when: above(reading, 10n) },
  { name: "default", when: always(true) },
);

// 3. The SDK validates the rules, sizes the rule contract's caps from the worst-case gas, publishes the config through the
//    RuleSetPublisher (which validates it again on chain) and creates the rule contract on the shared RuleSetLogic.
const { ruleContract, plan } = await deployRuleSet(w.popcorn, rules, { fund: parseEther("0.3"), stake: true });
console.log("rule contract", ruleContract, "conditionGas", plan.caps.conditionGas, "needs a stake for the foreign read:", !plan.classes[0]!.unstaked);

// 4. A trigger names its rule in triggerData. explainRule() says which node is false when a rule is not ready.
for (const [ruleId, v] of [[0, 500n], [1, 50n], [2, 5n]] as const) {
  await setValue(v);
  console.log((await explainRule(w.popcorn, ruleContract, { ruleId })).text);
  const hash = await w.trigger(ruleContract, { triggerData: triggerDataFor(ruleId) });
  const done = await w.watch(hash, { timeoutMs: 120_000 });
  console.log(`rule ${ruleId} triggered`, hash, done.state);
}
