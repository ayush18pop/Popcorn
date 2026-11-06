---
name: "Private Pool"
group: private
trigger: proof
priority: 1
status: built
runsOn: [alternative-staked]
gas: { total: 486660, tag: measured, network: local }
example: examples/private/private-payroll/run.json
related: [stealth-address, pool-pays, membership-proof]
properties: [private]
code: ["contracts/src/privacy/PrivatePool.sol", "contracts/src/privacy/PoseidonTree.sol", "packages/zk/circuits/withdraw.circom", "packages/sdk/src/privacy.ts"]
---

# Private Pool

## What it does

Holds fixed-size deposits and lets their owner withdraw to any address without linking the two, with no relayer and no gas top-up: the pool itself sends and pays for the withdrawal.

## When it fires

When a withdrawal carries a Groth16 proof that its note is in the pool and in an accepted association set, for this recipient and fee, under a root the pool has had.

## What it does then

Sends the denomination minus the fee to the recipient. The note's nullifier is the transaction's nonce key, so the protocol itself refuses a second spend.

## Runs on

The proof check calls a verifier contract, so the pool stakes: the alternative mempool. Roots live in the pool's own storage, so nothing depends on recent-root references.

## Code

```ts
const pool = await deployPrivatePool(clients, deployer, { denomination: parseEther("1"), associationProvider });
await poolDeposit(clients, pool.pool, note.commitment, pool.denomination);
const w = await withdrawProof({ note, pool: tree, poolIndex, assoc, assocIndex, recipient: BigInt(to), fee: pool.minFee, scope: BigInt(pool.pool) });
await anyone.trigger(pool.pool, poolWithdrawal({ ...w, recipient: to, fee: pool.minFee }));
```

## Limits

- Groth16 is zero-knowledge, not post-quantum: a quantum computer could forge a withdrawal proof.
- The keys come from a development trusted setup; production needs a multi-party ceremony.
- One denomination per pool, as in every fixed-note pool.
