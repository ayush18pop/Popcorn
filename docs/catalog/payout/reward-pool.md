---
name: "Reward Pool"
corner: payout
trigger: people
status: planned
mempool: { public: true, alt: unstaked }
gas: null
example: null
related: [caller-pays]
code: []
---

# Reward Pool

## What it does

A shared pool that pays reporters and triggerers, bounded per epoch.

## When it fires

When a rule in the same contract has fired and its reward is owed.

## What it does then

Pays the account that paid the gas, never an address named in the trigger data.

## Mempool

Planned to read only its own storage.

## Limits

- Rewards go to the payer or a proof-bound recipient only.
