---
name: "Upgrade Watch Pause"
corner: pause
trigger: dependency
status: planned
mempool: { public: false, alt: staked }
gas: null
example: null
related: [rule-sets]
code: []
---

# Upgrade Watch Pause

## What it does

Pause when a contract you depend on changes its code.

## When it fires

When a dependency's code hash differs from the recorded one (the rule-set code-hash leaf).

## What it does then

Pauses the integration until the owner reviews the new code.

## Mempool

Reads another contract's code hash.

## Limits

- Reads other contracts: alternative mempool, staked.
