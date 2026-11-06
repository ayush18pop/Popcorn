---
name: "Peg Break Exit"
corner: exit
trigger: market
status: planned
mempool: { public: false, alt: staked }
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

## Mempool

Reads a pool or oracle price.

## Limits

- Reads other contracts: alternative mempool, staked.
- No clock: "stays outside for an hour" is not expressible.
