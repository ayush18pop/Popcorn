---
name: "Collateral Top-Up"
corner: repay
trigger: invariant
status: planned
mempool: { public: false, alt: staked }
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

## Mempool

Reads the lending pool.

## Limits

- Reads other contracts: alternative mempool, staked.
