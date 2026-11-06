---
name: "Membership Proof"
group: prove
trigger: proof
priority: 2
status: built
runsOn: [alternative-staked]
gas: { total: 839489, tag: measured, network: local }
example: examples/gas/open-gas-network/run.json
related: [open-sponsor, hidden-guardians, private-pool]
properties: [private]
code: ["packages/zk/circuits/membership.circom", "contracts/src/proofs/MembershipVerifier.sol", "packages/zk/src/index.ts"]
---

# Membership Proof

## What it does

Prove you are one of a set (members, guardians, voters) without saying which one, once per scope. The set is a Poseidon Merkle root the verifying contract keeps.

## When it fires

When a Groth16 proof verifies for the set's root, a nullifier, the signal being approved and the contract's scope.

## What it does then

The contract that asked acts on the signal: admit an account, count a vote. The nullifier stops the same member from acting twice in the same scope.

## Runs on

Inside the module that uses it; the verifier is a separate contract, so that module stakes: the alternative mempool.

## Code

```ts
const tree = await MerkleTree.create(20, members.map((m) => m.commitment));
const p = await membershipProof({ secret, tree, index, signalHash, externalNullifier });
```

## Limits

- Groth16 is zero-knowledge, not post-quantum. Development trusted setup.
