---
name: "Withdraw All"
shape: action
tier: 2
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "address", what: "committed once at setup (forced exit), or chosen at the time and signed by a committed key (migrate)" }
perTrigger: "nothing"
output: "everything sent, once; the build refuses everything after"
useCases:
  ready: ["Forced exit after a contested takeover: Walkaway Exit", "Migrate with the backup key: Quantum-Ready Treasury"]
  configs: []
  ideas: ["Exit when a dependency is upgraded (with Code Hash Changed)"]
sdk: "exitTrigger"
related: [key-rotation, post-quantum-mode]
code: ["contracts/src/blocks/actions/ExitToAddress.sol"]
---

# Withdraw All

## Overview

Sends everything the build holds to one address, once. A committed address cannot be changed later, so whoever takes control of the build cannot redirect the exit.

## Configuration

- **address**: committed once at setup (forced exit), or chosen at the time and signed by a committed key (migrate)
- **trigger payload**: nothing
- **effect**: everything sent, once; the build refuses everything after

## Use cases

### Ready to use

- Forced exit after a contested takeover: Walkaway Exit
- Migrate with the backup key: Quantum-Ready Treasury

### Other use cases (not built)

- Exit when a dependency is upgraded (with Code Hash Changed)

## Usage

```ts
await anyone.trigger(account, exitTrigger());
```

```solidity
if (_contested()) _exit();                 // forced exit to the committed address
else if (_quantumSafeOnly()) _exitTo(signedTarget); // migrate
```

## Mempool

The block itself keeps plain storage and adds no mempool limit. The builds that use it today also check proofs or read other contracts, so they are staked on the alternative mempool.

## Gotchas

- A receiver that refuses ETH is credited and claims later; nothing is lost.
