---
name: "Pause The Target"
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
presets: ["Vault guards itself (Proof-of-Exploit Bounty)", "Security council pauses a protocol (with Anonymous Group Vote)"]
sdk: "blocks.pauseTarget"
related: [value-crosses-a-line, proof-that-the-rules-were-broken, none-of]
code: ["contracts/src/blocks/actions/PauseTarget.sol"]
---

# Pause The Target

## What it does

Stops a protocol. Each pause opens a new pause epoch, which is what a build keys its triggers on: one pause and one payout per broken state. Reopening is the owner's, and only when the build's check says it is safe.

## Inputs

- **target**: the build itself (a protocol that guards itself), or another contract with pause() that lets the build call it
- **safe to reopen**: the check that must hold before the owner can reopen
- **each trigger brings**: nothing
- **result**: paused, and a new pause epoch

## Presets

- Vault guards itself (Proof-of-Exploit Bounty)
- Security council pauses a protocol (with Anonymous Group Vote)

## Code

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

## Runs on

The pause flag lives in the build's own storage, so a check that reads it stays on the public mempool.

## Limits

- An outside target's pause() is called best effort: if it refuses, the action still completes and reports it.
