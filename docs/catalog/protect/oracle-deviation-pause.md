---
name: "Oracle Deviation Pause"
group: protect
trigger: market
status: planned
runsOn: [alternative-staked]
usedIn: [defi]
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

## Runs on

Reads the oracle contracts, so the rule contract stakes: the alternative mempool.

## Limits

- Reads other contracts: alternative mempool, staked.
