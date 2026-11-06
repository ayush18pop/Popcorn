---
name: "Post-Quantum Mode"
shape: action
tier: 3
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "backup key", what: "a post-quantum key, committed as a hash and never revealed until used" }
  - { name: "who flips", what: "the owner's signature, or a group vote" }
perTrigger: "the owner's signature, or a vote's quorum"
output: "switched: everyday signatures stop working"
useCases:
  ready: ["Quantum-Ready Treasury", "Sovereign Account"]
  configs: []
  ideas: []
sdk: "quantumData"
related: [withdraw-all, signature, anonymous-vote]
code: ["contracts/src/blocks/actions/QuantumSafeSwitch.sol"]
---

# Post-Quantum Mode

## Overview

A one-way switch. Before it flips, the everyday key works. After it flips, only the committed post-quantum backup key can act. A key committed long before a break cannot be added by an attacker at the time of the break.

## Configuration

- **backup key**: a post-quantum key, committed as a hash and never revealed until used
- **who flips**: the owner's signature, or a group vote
- **trigger payload**: the owner's signature, or a vote's quorum
- **effect**: switched: everyday signatures stop working

## Use cases

### Ready to use

- Quantum-Ready Treasury
- Sovereign Account

## Usage

```ts
await anyone.trigger(account, { triggerData: quantumData, verifyData: ownerSignature });
```

```solidity
if (_quantumSafeOnly()) return NO; // owner spends stop
_switchToQuantumSafe(byGroup);
```

## Mempool

The block itself keeps plain storage and adds no mempool limit. The builds that use it today also check proofs or read other contracts, so they are staked on the alternative mempool.

## Gotchas

- One way: there is no switch back.
