---
name: "Rule Pays"
corner: gas
trigger: payment
status: built
mempool: { public: true, alt: unstaked }
gas: null
example: examples/gas/rule-pays-counter/run.json
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

## Mempool

Payment is approved in the rule contract's own VERIFY frame.

## Code

```ts
const deployer = createWalletClient({ account, chain, transport: http() }).extend(popcorn({ devnet }));
const { ruleContract } = await deployer.deployRule({ logic: { bytecode }, fund: parseEther("0.01") });

const anyone = createPublicClient({ chain, transport: http() }).extend(popcorn({ devnet }));
const hash = await anyone.trigger(ruleContract); // no account, no ETH
```

## Limits

- Keep the balance at or above the worst-case cost of one trigger (`maxCostPerTrigger`).
