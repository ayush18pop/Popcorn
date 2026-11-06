---
name: "Public Gas Sponsor"
shape: payer
tier: 3
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "policy", what: "per-account limits, everyone, accounts built on allowed logic, or members proven with Prove You're In The Group" }
  - { name: "fee cap and period", what: "the most it pays per gas, and the budget period" }
perTrigger: "the sponsor named as payer (and a membership proof for a new member)"
output: "the transaction is paid, and the budget charged"
presets: ["Open Gas Network: members get free transactions, anonymously"]
sdk: "deployOpenSponsor"
related: [prove-youre-in-the-group, contract-pays-the-gas]
code: ["contracts/sponsor/OpenSponsor.yul"]
---

# Public Gas Sponsor

## What it does

Pays other accounts' gas under a public, on-chain policy instead of a server that signs approvals: whoever meets the policy is sponsored, and nobody can be quietly dropped.

## Inputs

- **policy**: per-account limits, everyone, accounts built on allowed logic, or members proven with Prove You're In The Group
- **fee cap and period**: the most it pays per gas, and the budget period
- **each trigger brings**: the sponsor named as payer (and a membership proof for a new member)
- **result**: the transaction is paid, and the budget charged

## Presets

- Open Gas Network: members get free transactions, anonymously

## Code

```ts
const sponsor = (await deployOpenSponsor(clients, { owner, period: 3600n, maxFee: parseGwei("500"), defaultLimit: parseEther("3") })).address;
await anyone.trigger(appAccount, sponsored(sponsor));
```

```solidity
// contracts/sponsor/OpenSponsor.yul: a payer written in Yul; configure it, do not inherit it
```

## Runs on

The policy reads the sponsor's own settings, which only a staked payer may do: the alternative mempool.

## Limits

- Budgets are charged the worst-case cost, so a budget runs out a little early.
- Validation cannot read the clock: a period rolls over in the accounting frame.
