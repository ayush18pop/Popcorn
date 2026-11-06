---
name: "Hidden Guardians"
group: sign
trigger: proof
status: built
runsOn: [alternative-staked]
gas: null
example: examples/protect/walkaway-exit/run.json
related: [membership-proof, quantum-switch, forced-exit]
properties: [private]
code: ["contracts/src/account/HiddenGuardians.sol", "contracts/src/account/SovereignAccount.sol", "packages/zk/circuits/membership.circom"]
---

# Hidden Guardians

## What it does

k-of-n guardians who recover or protect an account without anyone learning who they are, so none of them can be singled out, bribed or pressured by name. None needs ETH: the account pays for each vote.

## When it fires

When a vote carries a membership proof for the guardian set, bound to the proposal and the current round.

## What it does then

Counts the vote; the nullifier is the vote's nonce key, so a guardian cannot vote twice in a round. At the threshold the proposal runs (a new owner after a delay, or the quantum switch) and a new round opens, voiding the other votes.

## Runs on

The proof check calls a verifier contract, so the account stakes: the alternative mempool.

## Code

```ts
const round = await pub.readContract({ address: account, abi: sovereignAccountAbi, functionName: "guardianRound" });
const p = await membershipProof({ secret, tree, index, signalHash: guardianSignal(proposal, round), externalNullifier: guardianScope(account, round) });
await anyone.trigger(account, voteTrigger(proposal, p.nullifierHash, p.proof));
```

## Limits

- A rotation waits out a delay, during which the current owner can contest it.
- Groth16 is zero-knowledge, not post-quantum.
