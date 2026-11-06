---
name: "Health Exit"
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

# Health Exit

## What it does

Withdraw from a venue when its own accounting breaks.

## When it fires

When the venue's invariant fails.

## What it does then

Withdraws everything the position can.

## Runs on

Reads the venue's accounting, so the rule contract stakes: the alternative mempool.

## Limits

- Reads other contracts: alternative mempool, staked.
