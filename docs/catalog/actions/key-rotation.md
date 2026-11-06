---
name: "Key Rotation (timelocked)"
shape: action
tier: 2
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "delay", what: "how long a handover waits" }
  - { name: "who proposes", what: "the block that may propose (usually a vote)" }
  - { name: "who contests", what: "the current key" }
perTrigger: "none: proposed by another block, contested and finalised by ordinary calls"
output: "pending, contested, or handed over"
useCases:
  ready: ["Guardian recovery the owner can contest: Walkaway Exit, Sovereign Account"]
  configs: []
  ideas: ["Rotate an operator key with a public delay"]
sdk: "finalizeRecovery"
related: [anonymous-vote, withdraw-all]
code: ["contracts/src/blocks/actions/KeyHandover.sol"]
---

# Key Rotation (timelocked)

## Overview

Moves control of the build to a new key slowly and in public: proposed, then a delay in which the current key can contest, then anyone completes it. A contest is an output another block reads.

## Configuration

- **delay**: how long a handover waits
- **who proposes**: the block that may propose (usually a vote)
- **who contests**: the current key
- **trigger payload**: none: proposed by another block, contested and finalised by ordinary calls
- **effect**: pending, contested, or handed over

## Use cases

### Ready to use

- Guardian recovery the owner can contest: Walkaway Exit, Sovereign Account

### Other use cases (not built)

- Rotate an operator key with a public delay

## Usage

```ts
await contestRecovery(clients, account, ownerParams, ownerSignature);
await finalizeRecovery(clients, account);
```

```solidity
_proposeHandover(newKeyHash);  // from a vote's quorum
_contestHandover();            // after checking the current key's signature
_finalizeHandover();           // anyone, after the delay
```

## Mempool

The block itself keeps plain storage and adds no mempool limit. The builds that use it today also check proofs or read other contracts, so they are staked on the alternative mempool.

## Gotchas

- The delay is the owner's window to notice; choose it longer than the owner can be away.
