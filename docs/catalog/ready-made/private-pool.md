---
name: "Private Pool"
shape: ready-made
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "denomination", what: "one fixed note size" }
  - { name: "association provider", what: "who publishes the accepted deposits" }
perTrigger: "nullifier, roots, recipient, fee; the withdraw proof"
output: "paid to a fresh address, gas taken from the note"
builtFrom: [prove-youre-in-the-group, contract-pays-the-gas]
sdk: "deployPrivatePool"
related: [stealth-vault, prove-youre-in-the-group]
code: ["contracts/src/privacy/PrivatePool.sol"]
---

# Private Pool

## What it does

A fixed-denomination private pool whose withdrawals pay their own gas: no relayer, no gas top-up that links the recipient to you. A withdrawal proves its deposit is in an accepted association set without saying which one.

## Built from

Commitment tree, spend once (the nullifier is the nonce key), association set (prove you're in the group), pay out safely, contract pays the gas.

## Inputs

- **denomination**: one fixed note size
- **association provider**: who publishes the accepted deposits
- **each trigger brings**: nullifier, roots, recipient, fee; the withdraw proof
- **result**: paid to a fresh address, gas taken from the note

## Code

```ts
const pool = await deployPrivatePool(clients, deployer, { denomination: parseEther("1"), associationProvider });
await anyone.trigger(pool.pool, poolWithdrawal({ ...w, recipient: to, fee: pool.minFee }));
```

## Runs on

A Groth16 check: staked, the alternative mempool.

## Limits

- Groth16 is zero-knowledge, not post-quantum.
- Development trusted setup.
