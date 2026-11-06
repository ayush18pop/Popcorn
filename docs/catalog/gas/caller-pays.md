---
name: "Caller Pays"
group: gas
trigger: payment
status: built
runsOn: [public, alternative]
gas: null
example: null
related: [rule-pays, partial-repay-shield]
code: ["contracts/src/payers/CallerPays.sol", "packages/sdk/examples/02-caller-pays.ts"]
---

# Caller Pays

## What it does

A separate payer approves and pays the gas, and the reward goes to whoever actually paid.

## When it fires

When the condition is true and a payer's VERIFY frame approves payment.

## What it does then

The action receives the payer from Core (read from the payer's own frame) and pays the reward there.

## Runs on

The payer's own verification approves payment and the rule contract approves execution, each reading only its own storage: the public mempool and the alternative mempool.

## Code

```ts
const hash = await client.trigger(ruleContract, { payer: account });
```

## Limits

- Fee caps are unused and must be zero; the factory refuses a caller-pays logic deployed as rule-pays.
