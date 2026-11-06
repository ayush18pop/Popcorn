---
name: "Keyed-Nonce Liquidation"
group: protect
trigger: tickets
status: planned
runsOn: [alternative-staked]
usedIn: [defi]
gas: null
example: null
related: [partial-repay-shield]
code: []
---

# Keyed-Nonce Liquidation

## What it does

One winner per liquidation event. Every other attempt is invalid, so losers pay nothing.

## When it fires

When a position is liquidatable; the nonce key is the event, so only one trigger can be included.

## What it does then

Liquidates and pays the winner.

## Runs on

Reads the lending pool, so the rule contract stakes: the alternative mempool.

## Limits

- Reads other contracts: alternative mempool, staked.
