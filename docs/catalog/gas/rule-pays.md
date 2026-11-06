---
name: "Rule Pays"
group: gas
trigger: payment
priority: 2
status: built
runsOn: [public, alternative]
gas: null
example: examples/protect/walkaway-exit/run.json
related: [caller-pays, core]
code: ["contracts/src/payers/RulePays.sol", "packages/sdk/examples/01-rule-pays.ts"]
---

# Rule Pays

## What it does

The rule contract pays for its own triggers, so a wallet with 0 ETH can send them.

## When it fires

Whenever the rule contract's condition is true; Core approves execution and payment together (frame flags 3).

## What it does then

The rule contract's balance pays the gas, capped by the fee caps fixed at deployment.

## Runs on

Payment is approved in the rule contract's own verification, which reads only its own storage: the public mempool and the alternative mempool.

## Code

```ts
const deployer = createWalletClient({ account, chain, transport: http() }).extend(popcorn({ devnet }));
const { ruleContract } = await deployer.deployRule({ logic: { bytecode }, fund: parseEther("0.01") });

const anyone = createPublicClient({ chain, transport: http() }).extend(popcorn({ devnet }));
const hash = await anyone.trigger(ruleContract); // no account, no ETH
```

## Limits

- Keep the balance at or above the worst-case cost of one trigger (`maxCostPerTrigger`).
