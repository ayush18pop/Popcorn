---
name: "Sponsor With Limits"
corner: gas
trigger: market
status: planned
mempool: { public: true, alt: unstaked }
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

## Mempool

Planned on own-storage budgets.

## Limits

- Budgets advance with the sponsor's own actions; there is no clock.
