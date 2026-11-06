---
name: "Threshold Condition"
corner: build
trigger: market
status: built
mempool: { public: false, alt: staked }
gas: null
example: null
related: [rule-sets, pool-guard]
code: ["contracts/src/conditions/ThresholdCondition.sol", "contracts/src/examples/ThresholdAlarm.sol"]
---

# Threshold Condition

## What it does

True when a value read from another contract is strictly above or below a line. Fails closed on a bad read.

## When it fires

When `target.selector()` returns a value beyond `line`.

## What it does then

Your action. The condition only decides.

## Mempool

Reads a value from another contract; the sidecar allows that only for a staked rule contract.

## Limits

- Read the value from the rule contract's own storage instead to stay on the public mempool.
