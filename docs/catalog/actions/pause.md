---
name: "Pause"
shape: action
tier: 1
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "target", what: "the build itself (a protocol that guards itself), or another contract with pause() that lets the build call it" }
  - { name: "safe to reopen", what: "the check that must hold before the owner can reopen" }
perTrigger: "nothing"
output: "paused, and a new pause epoch"
useCases:
  ready: ["The vault pauses itself: Proof-of-Exploit Bounty", "Pause another contract: SDK blocks devnet test"]
  configs: []
  ideas: ["Security council pause (with Anonymous Vote)"]
sdk: "blocks.pauseTarget"
related: [compare, exploit-proof, not]
code: ["contracts/src/blocks/actions/PauseTarget.sol"]
---

# Pause

## Overview

Stops a protocol. Each pause opens a new pause epoch, which is what a build keys its triggers on: one pause and one payout per broken state. Reopening is the owner's, and only when the build's check says it is safe.

## Configuration

- **target**: the build itself (a protocol that guards itself), or another contract with pause() that lets the build call it
- **safe to reopen**: the check that must hold before the owner can reopen
- **trigger payload**: nothing
- **effect**: paused, and a new pause epoch

## Use cases

### Ready to use

- The vault pauses itself: Proof-of-Exploit Bounty
- Pause another contract: SDK blocks devnet test

### Other use cases (not built)

- Security council pause (with Anonymous Vote)

## Usage

```ts
blocks.pauseTarget(pool) // calls pool.pause(); grant the build the pauser role
```

```solidity
contract MyVault is DemoVault /* is PauseTarget */ {
    function deposit(uint256 a) external whenNotPaused { ... }
    function action(bytes calldata, address) internal override { _pauseSelf(); }
    function _safeToReopen() internal view override returns (bool) { return Join.noneOf(_belowFloor()).isYes(); }
}
```

## Mempool

The pause flag lives in the build's own storage, so a check that reads it stays on the public mempool.

## Gotchas

- An outside target's pause() is called best effort: if it refuses, the action still completes and reports it.
