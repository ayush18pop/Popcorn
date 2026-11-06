---
name: "Paymaster"
shape: payer
tier: 3
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "policy", what: "per-account limits, everyone, accounts built on allowed logic, or members proven with Membership Proof" }
  - { name: "fee cap and period", what: "the most it pays per gas, and the budget period" }
perTrigger: "the sponsor named as payer (and a membership proof for a new member)"
output: "the transaction is paid, and the budget charged"
useCases:
  ready: ["Open Gas Network"]
  configs: ["Per-account limits", "Only accounts built on allowed logic", "Members only (Membership Proof)"]
  ideas: []
sdk: "deployOpenSponsor"
related: [membership-proof, self-paying]
code: ["contracts/sponsor/OpenSponsor.yul"]
---

# Paymaster

## Overview

Pays other accounts' gas under a public, on-chain policy instead of a server that signs approvals: whoever meets the policy is sponsored, and nobody can be quietly dropped.

## Configuration

- **policy**: per-account limits, everyone, accounts built on allowed logic, or members proven with Membership Proof
- **fee cap and period**: the most it pays per gas, and the budget period
- **trigger payload**: the sponsor named as payer (and a membership proof for a new member)
- **effect**: the transaction is paid, and the budget charged

## Use cases

### Ready to use

- Open Gas Network

### Common configurations

- Per-account limits
- Only accounts built on allowed logic
- Members only (Membership Proof)

## Usage

```ts
const sponsor = (await deployOpenSponsor(clients, { owner, period: 3600n, maxFee: parseGwei("500"), defaultLimit: parseEther("3") })).address;
await anyone.trigger(appAccount, sponsored(sponsor));
```

```solidity
// contracts/sponsor/OpenSponsor.yul: a payer written in Yul; configure it, do not inherit it
```

## Mempool

The policy reads the sponsor's own settings, which only a staked payer may do: the alternative mempool.

## Gotchas

- Budgets are charged the worst-case cost, so a budget runs out a little early.
- Validation cannot read the clock: a period rolls over in the accounting frame.
