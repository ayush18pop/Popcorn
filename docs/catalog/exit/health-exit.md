---
name: "Health Exit"
corner: exit
trigger: invariant
status: planned
mempool: { public: false, alt: staked }
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

## Mempool

Reads the venue's accounting.

## Limits

- Reads other contracts: alternative mempool, staked.
