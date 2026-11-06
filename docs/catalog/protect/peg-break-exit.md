---
name: "Peg Break Exit"
group: protect
trigger: market
status: planned
runsOn: [alternative-staked]
usedIn: [defi]
gas: null
example: null
related: [oracle-deviation-pause]
code: []
---

# Peg Break Exit

## What it does

Leave a stablecoin position when the peg breaks.

## When it fires

When the price stays outside the band across a crossing check.

## What it does then

Withdraws to a safe asset.

## Runs on

Reads a pool or oracle price, so the rule contract stakes: the alternative mempool.

## Limits

- Reads other contracts: alternative mempool, staked.
- No clock: "stays outside for an hour" is not expressible.
