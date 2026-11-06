---
name: "Partial Repay Shield"
group: protect
trigger: invariant
priority: 4
status: built
runsOn: [alternative-staked]
usedIn: [defi]
gas: null
example: null
related: [caller-pays, health-exit]
code: ["contracts/src/templates/PartialRepayShield.sol", "packages/sdk/examples/02-caller-pays.ts"]
---

# Partial Repay Shield

## What it does

A loan that repays a quarter of its debt when its health factor falls below 1.1. Whoever triggers it pays the gas and earns 0.5%.

## When it fires

When the user's health factor is below the threshold, there is debt, and the shield's reserve covers the repayment plus the reward.

## What it does then

Bumps its rescue epoch first, repays a quarter of the debt from its reserve and pays the triggerer 0.5% of the amount repaid. If anything fails it records the skip and returns: it never reverts.

## Runs on

Reads the lending pool's health factor, so the rule contract stakes: the alternative mempool.

## Code

```ts
// caller-pays: the payer approves and pays, and is the one rewarded
const hash = await searcher.trigger(shield, { payer: searcherAccount });
const status = await searcher.watch(hash);
```

## Limits

- Reads another contract, so it needs stake on the alternative mempool; the public mempool refuses it.
- The user keeps a reserve of the debt token in the shield; without it the condition stays false.
- Keyed on its own rescue epoch, so nobody can cancel pending rescues by moving the pool's position nonce.
