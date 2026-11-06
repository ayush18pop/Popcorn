---
name: "Privacy Pool"
shape: ready-made
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "denomination", what: "one fixed note size" }
  - { name: "association provider", what: "who publishes the accepted deposits" }
perTrigger: "nullifier, roots, recipient, fee; the withdraw proof"
output: "paid to a fresh address, gas taken from the note"
useCases:
  ready: ["Private Payroll", "Sovereign Account"]
  configs: []
  ideas: []
builtFrom: [membership-proof, self-paying]
sdk: "deployPrivatePool"
related: [stealth-addresses, membership-proof]
code: ["contracts/src/privacy/PrivatePool.sol"]
---

# Privacy Pool

## Overview

A fixed-denomination private pool whose withdrawals pay their own gas: no relayer, no gas top-up that links the recipient to you. A withdrawal proves its deposit is in an accepted association set without saying which one.

## Composed of

Commitment tree, spend once (the nullifier is the nonce key), association set (Membership Proof), pay out safely, Self-Paying.

## Configuration

- **denomination**: one fixed note size
- **association provider**: who publishes the accepted deposits
- **trigger payload**: nullifier, roots, recipient, fee; the withdraw proof
- **effect**: paid to a fresh address, gas taken from the note

## Use cases

### Ready to use

- Private Payroll
- Sovereign Account

## Usage

```ts
const pool = await deployPrivatePool(clients, deployer, { denomination: parseEther("1"), associationProvider });
await anyone.trigger(pool.pool, poolWithdrawal({ ...w, recipient: to, fee: pool.minFee }));
```

## Mempool

A Groth16 check: staked, the alternative mempool.

## Gotchas

- Groth16 is zero-knowledge, not post-quantum.
- Development trusted setup.
