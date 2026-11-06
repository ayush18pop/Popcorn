---
name: "Share Price Floor Pause"
corner: pause
trigger: invariant
status: planned
mempool: { public: true, alt: unstaked }
gas: null
example: null
related: [guarded-vault]
code: []
---

# Share Price Floor Pause

## What it does

The guarded vault's invariant, packaged for any ERC-4626 vault.

## When it fires

When assets per share fall below a floor.

## What it does then

Pauses the vault.

## Mempool

Planned as a drop-in for any ERC-4626 vault that keeps its accounting in its own storage.

## Limits

- Needs the vault to be its own rule contract, or to expose its accounting cheaply.
