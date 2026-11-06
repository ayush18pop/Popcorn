---
name: "Sponsor With Limits"
group: gas
trigger: market
status: planned
runsOn: [public, alternative]
gas: null
example: null
related: [rule-pays]
code: []
---

# Sponsor With Limits

## What it does

Sponsor other accounts' gas with per-epoch and per-account limits.

## When it fires

When the sponsored call matches the allowlist and the budget has room.

## What it does then

Pays for the call and debits the budget.

## Runs on

The sponsor's policy and budgets live in its own storage: the public mempool and the alternative mempool.

## Limits

- Budgets advance with the sponsor's own actions; there is no clock.
