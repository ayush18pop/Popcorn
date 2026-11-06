---
name: "Anonymous Vote (K-of-N)"
shape: action
tier: 2
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "group", what: "the members' root" }
  - { name: "k", what: "how many votes decide" }
  - { name: "what quorum does", what: "the block the build plugs in next: hand over, switch, pause" }
perTrigger: "a proposal and a nullifier (trigger data), a membership proof (verify data)"
output: "a vote counted; at k votes, the next block runs"
useCases:
  ready: ["Guardian recovery: Walkaway Exit", "Guardians turn on Post-Quantum Mode: Quantum-Ready Treasury"]
  configs: []
  ideas: ["Security council pause", "DAO committee decisions"]
sdk: "voteTrigger"
related: [membership-proof, key-rotation, post-quantum-mode]
code: ["contracts/src/blocks/actions/AnonymousGroupVote.sol"]
---

# Anonymous Vote (K-of-N)

## Overview

k of n members agree on a proposal, and the chain never learns which members voted. None of them can be singled out, and none needs ETH: the build pays for the votes.

## Configuration

- **group**: the members' root
- **k**: how many votes decide
- **what quorum does**: the block the build plugs in next: hand over, switch, pause
- **trigger payload**: a proposal and a nullifier (trigger data), a membership proof (verify data)
- **effect**: a vote counted; at k votes, the next block runs

## Use cases

### Ready to use

- Guardian recovery: Walkaway Exit
- Guardians turn on Post-Quantum Mode: Quantum-Ready Treasury

### Other use cases (not built)

- Security council pause
- DAO committee decisions

## Usage

```ts
const p = await membershipProof({ secret, tree, index, signalHash: guardianSignal(proposal, round), externalNullifier: guardianScope(account, round) });
await anyone.trigger(account, voteTrigger(proposal, p.nullifierHash, p.proof));
```

```solidity
function _onQuorum(bytes32 proposal) internal override {
    if (proposal == PROPOSAL_QUANTUM) _switchToQuantumSafe(true);
    else _proposeHandover(proposal);
}
```

## Mempool

Each vote carries a Groth16 proof (about 200k gas): a staked build on the alternative mempool.

## Gotchas

- Zero-knowledge, not post-quantum.
