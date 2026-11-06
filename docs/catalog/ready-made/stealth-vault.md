---
name: "Stealth Vault"
shape: ready-made
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "min fee", what: "the least a spend pays the vault for gas" }
perTrigger: "commitment, recipient, fee; the spend proof"
output: "paid to the recipient, gas taken from the payment"
builtFrom: [contract-pays-the-gas]
sdk: "deployStealthVault"
related: [private-pool]
code: ["contracts/src/privacy/StealthVault.sol"]
---

# Stealth Vault

## What it does

Receive to a one-time address nobody can link to you, and spend it without a gas top-up that would. The announcement is ML-KEM, so recording it today does not reveal the receiver to a future quantum computer.

## Built from

Ml-kem announcements, spend once, a stealth spend proof, pay out safely, contract pays the gas.

## Inputs

- **min fee**: the least a spend pays the vault for gas
- **each trigger brings**: commitment, recipient, fee; the spend proof
- **result**: paid to the recipient, gas taken from the payment

## Code

```ts
const payment = await prepareStealthPayment(receiverMetaAddress, stealthCommitment);
await stealthPay(clients, vault, payment, parseEther("1"));
await anyone.trigger(vault, stealthSpend({ commitment, recipient: to, fee, proof }));
```

## Runs on

A Groth16 check: staked, the alternative mempool.

## Limits

- The spend proof is Groth16: zero-knowledge, not post-quantum. The announcement is post-quantum (ML-KEM-768).
