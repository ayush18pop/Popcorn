---
name: "Oracle Deviation Pause"
corner: pause
trigger: market
status: planned
mempool: { public: false, alt: staked }
gas: null
example: null
related: [pool-guard, rule-sets]
code: []
---

# Oracle Deviation Pause

## What it does

Pause when two price sources disagree by more than a band.

## When it fires

When the ratio of two oracle reads leaves the allowed band.

## What it does then

Pauses the markets that use the price.

## Mempool

Reads oracle contracts.

## Limits

- Reads other contracts: alternative mempool, staked.
