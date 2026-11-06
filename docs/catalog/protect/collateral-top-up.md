---
name: "Collateral Top-Up"
group: protect
trigger: invariant
status: planned
runsOn: [alternative-staked]
usedIn: [defi]
gas: null
example: null
related: [partial-repay-shield]
code: []
---

# Collateral Top-Up

## What it does

Add collateral instead of repaying when health falls.

## When it fires

When health falls below the threshold.

## What it does then

Moves collateral from the reserve into the position.

## Runs on

Reads the lending pool, so the rule contract stakes: the alternative mempool.

## Limits

- Reads other contracts: alternative mempool, staked.
