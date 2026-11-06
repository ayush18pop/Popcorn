---
name: "Upgrade Watch Pause"
group: protect
trigger: dependency
status: planned
runsOn: [alternative-staked]
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

## Runs on

Reads the watched contract's code hash, so the rule contract stakes: the alternative mempool.

## Limits

- Reads other contracts: alternative mempool, staked.
