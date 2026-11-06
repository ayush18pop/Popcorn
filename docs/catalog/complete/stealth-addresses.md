---
name: "Stealth Addresses"
shape: ready-made
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "min fee", what: "the least a spend pays the vault for gas" }
perTrigger: "commitment, recipient, fee; the spend proof"
output: "paid to the recipient, gas taken from the payment"
useCases:
  ready: ["Private Payroll", "Sovereign Account"]
  configs: []
  ideas: []
builtFrom: [self-paying]
sdk: "deployStealthVault"
related: [privacy-pool]
code: ["contracts/src/privacy/StealthVault.sol"]
---

# Stealth Addresses

## Overview

Receive to a one-time address nobody can link to you, and spend it without a gas top-up that would. The announcement is ML-KEM, so recording it today does not reveal the receiver to a future quantum computer.

## Composed of

ML-KEM announcements, spend once, a stealth spend proof, pay out safely, Self-Paying.

## Configuration

- **min fee**: the least a spend pays the vault for gas
- **trigger payload**: commitment, recipient, fee; the spend proof
- **effect**: paid to the recipient, gas taken from the payment

## Use cases

### Ready to use

- Private Payroll
- Sovereign Account

## Usage

```ts
const payment = await prepareStealthPayment(receiverMetaAddress, stealthCommitment);
await stealthPay(clients, vault, payment, parseEther("1"));
await anyone.trigger(vault, stealthSpend({ commitment, recipient: to, fee, proof }));
```

## Mempool

A Groth16 check: staked, the alternative mempool.

## Gotchas

- The spend proof is Groth16: zero-knowledge, not post-quantum. The announcement is post-quantum (ML-KEM-768).
