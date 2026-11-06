---
name: "Anonymous Group Vote"
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
presets: ["Guardians recover an account (Walkaway Exit, Sovereign Account)", "A security council pauses a protocol", "Guardians flip the quantum switch"]
sdk: "voteTrigger"
related: [prove-youre-in-the-group, hand-over-to-a-new-key, switch-to-quantum-safe-only]
code: ["contracts/src/blocks/actions/AnonymousGroupVote.sol"]
---

# Anonymous Group Vote

## What it does

k of n members agree on a proposal, and the chain never learns which members voted. None of them can be singled out, and none needs ETH: the build pays for the votes.

## Inputs

- **group**: the members' root
- **k**: how many votes decide
- **what quorum does**: the block the build plugs in next: hand over, switch, pause
- **each trigger brings**: a proposal and a nullifier (trigger data), a membership proof (verify data)
- **result**: a vote counted; at k votes, the next block runs

## Presets

- Guardians recover an account (Walkaway Exit, Sovereign Account)
- A security council pauses a protocol
- Guardians flip the quantum switch

## Code

```ts
await anyone.trigger(account, await s.vote(guardianIndex, proposal));
```

```solidity
function _onQuorum(bytes32 proposal) internal override {
    if (proposal == PROPOSAL_QUANTUM) _switchToQuantumSafe(true);
    else _proposeHandover(proposal);
}
```

## Runs on

Each vote carries a Groth16 proof (about 200k gas): a staked build on the alternative mempool.

## Limits

- Zero-knowledge, not post-quantum.
