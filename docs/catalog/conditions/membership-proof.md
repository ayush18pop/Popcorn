---
name: "Membership Proof (ZK)"
shape: check
tier: 2
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "group", what: "a Poseidon Merkle root of the members (or of accepted deposits: an association set)" }
  - { name: "signal and scope", what: "what the member approves, and where (one proof per member per scope)" }
perTrigger: "a nullifier hash and the signal (trigger data), the proof (verify data)"
output: "yes / no / unknown"
useCases:
  ready: ["Association set: Private Payroll (Privacy Pool)", "One sponsored account per member: Open Gas Network", "Guardian votes: Walkaway Exit"]
  configs: []
  ideas: ["An allowlisted claim that does not link the claimer's addresses"]
sdk: "membershipProof (@popcorn/zk)"
related: [anonymous-vote, paymaster]
code: ["contracts/src/blocks/checks/GroupMembership.sol"]
---

# Membership Proof (ZK)

## Overview

Proves the sender is one of a group without saying which member. The same member proving twice for the same scope gives the same nullifier; used as the nonce key, the protocol itself refuses the second time.

## Configuration

- **group**: a Poseidon Merkle root of the members (or of accepted deposits: an association set)
- **signal and scope**: what the member approves, and where (one proof per member per scope)
- **trigger payload**: a nullifier hash and the signal (trigger data), the proof (verify data)
- **returns**: yes / no / unknown

## Use cases

### Ready to use

- Association set: Private Payroll (Privacy Pool)
- One sponsored account per member: Open Gas Network
- Guardian votes: Walkaway Exit

### Other use cases (not built)

- An allowlisted claim that does not link the claimer's addresses

## Usage

```ts
const tree = await MerkleTree.create(20, members.map((m) => m.commitment));
const p = await membershipProof({ secret, tree, index, signalHash, externalNullifier });
```

```solidity
function condition(bytes calldata data, bytes calldata proof) internal view override returns (bool) {
    (uint256 nullifierHash, bytes32 signal) = abi.decode(data, (uint256, bytes32));
    return _inGroup(groupRoot, nullifierHash, _field(signal), _field(SCOPE), proof).isYes();
}
```

## Mempool

A Groth16 check costs about 200k gas: a staked build on the alternative mempool.

## Gotchas

- Zero-knowledge, not post-quantum. Development trusted setup.
