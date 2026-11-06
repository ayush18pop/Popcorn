---
name: "Share Price Floor Pause"
group: protect
trigger: invariant
priority: 6
status: planned
runsOn: [public, alternative]
usedIn: [defi]
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

## Runs on

Reads an ERC-4626 vault's accounting kept in its own storage: the public mempool and the alternative mempool.

## Limits

- Needs the vault to be its own rule contract, or to expose its accounting cheaply.
