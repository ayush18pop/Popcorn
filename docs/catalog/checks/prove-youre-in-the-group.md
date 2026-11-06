---
name: "Prove You're In The Group"
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
presets: ["Association set: my deposit is one of the accepted ones (Private Pool)", "One sponsored account per member (Public Gas Sponsor)", "A vote (Anonymous Group Vote)"]
sdk: "membershipProof (@popcorn/zk)"
related: [anonymous-group-vote, public-gas-sponsor]
code: ["contracts/src/blocks/checks/GroupMembership.sol"]
---

# Prove You're In The Group

## What it does

Proves the sender is one of a group without saying which member. The same member proving twice for the same scope gives the same nullifier; used as the nonce key, the protocol itself refuses the second time.

## Inputs

- **group**: a Poseidon Merkle root of the members (or of accepted deposits: an association set)
- **signal and scope**: what the member approves, and where (one proof per member per scope)
- **each trigger brings**: a nullifier hash and the signal (trigger data), the proof (verify data)
- **answers**: yes / no / unknown

## Presets

- Association set: my deposit is one of the accepted ones (Private Pool)
- One sponsored account per member (Public Gas Sponsor)
- A vote (Anonymous Group Vote)

## Code

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

## Runs on

A Groth16 check costs about 200k gas: a staked build on the alternative mempool.

## Limits

- Zero-knowledge, not post-quantum. Development trusted setup.
