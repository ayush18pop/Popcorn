---
name: "Rule Sets"
corner: build
trigger: tooling
status: built
mempool: { public: true, alt: staked }
gas: null
example: null
related: [pool-guard, threshold-condition]
code: ["contracts/src/rules/RuleSet.sol", "contracts/src/rules/RuleSetCodec.sol", "packages/sdk/examples/07-rule-set.ts"]
---

# Rule Sets

## What it does

Conditions as data: AND / OR / NOT / k-of-n over compare, range, crossing, delta, ratio, balance, code hash and flag leaves, with an action per rule.

## When it fires

When the named rule's tree evaluates to true. Each leaf is true, false or unknown; unknown never fires, even under NOT.

## What it does then

One capped call per rule, best effort; a failed call is reported in an event, never reverted.

## Mempool

A rule's mempool is its strictest leaf's: own-storage leaves are public, leaves that read other contracts need stake.

## Code

```ts
// gas per rule and the mempool each leaf needs, then deploy
const { ruleContract, plan } = await deployRuleSet(wallet.popcorn, rules, { fund: parseEther("0.3"), stake: true });
```

## Limits

- Each external read has its own gas cap, so one misbehaving target cannot starve the tree.
