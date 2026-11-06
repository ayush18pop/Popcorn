---
name: "Hand Over To A New Key"
shape: action
tier: 2
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "delay", what: "how long a handover waits" }
  - { name: "who proposes", what: "the block that may propose (usually a vote)" }
  - { name: "who contests", what: "the current key" }
perTrigger: "none: proposed by another block, contested and finalised by ordinary calls"
output: "pending, contested, or handed over"
presets: ["Guardian recovery with a delay (Walkaway Exit)"]
sdk: "finalizeRecovery"
related: [anonymous-group-vote, exit-to-an-address]
code: ["contracts/src/blocks/actions/KeyHandover.sol"]
---

# Hand Over To A New Key

## What it does

Moves control of the build to a new key slowly and in public: proposed, then a delay in which the current key can contest, then anyone completes it. A contest is an output another block reads.

## Inputs

- **delay**: how long a handover waits
- **who proposes**: the block that may propose (usually a vote)
- **who contests**: the current key
- **each trigger brings**: none: proposed by another block, contested and finalised by ordinary calls
- **result**: pending, contested, or handed over

## Presets

- Guardian recovery with a delay (Walkaway Exit)

## Code

```ts
await contestRecovery(clients, account, ownerParams, ownerSignature);
await finalizeRecovery(clients, account);
```

```solidity
_proposeHandover(newKeyHash);  // from a vote's quorum
_contestHandover();            // after checking the current key's signature
_finalizeHandover();           // anyone, after the delay
```

## Runs on

Plain storage; it runs wherever the build that holds it runs.

## Limits

- The delay is the owner's window to notice; choose it longer than the owner can be away.
