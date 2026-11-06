---
name: "Payer Gets Rewarded"
shape: payer
tier: 2
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "reward", what: "token and amount, from the build" }
perTrigger: "the payer's approval (it signs the whole transaction)"
output: "the payer is paid; a copier would have to pay the gas itself"
presets: ["Keepers rescue a loan (Auto-Repay Loan)"]
sdk: "trigger({ payer })"
related: [contract-pays-the-gas, repay-a-loan]
code: ["contracts/src/payers/CallerPays.sol"]
---

# Payer Gets Rewarded

## What it does

Whoever pays the gas for a trigger earns a reward from the build. The reward goes to the account that actually paid, never to a name in the trigger data, so copying a pending trigger gains nothing.

## Inputs

- **reward**: token and amount, from the build
- **each trigger brings**: the payer's approval (it signs the whole transaction)
- **result**: the payer is paid; a copier would have to pay the gas itself

## Presets

- Keepers rescue a loan (Auto-Repay Loan)

## Code

```ts
const hash = await client.trigger(ruleContract, { payer: account });
```

```solidity
_payReward(address(token), reward); // to the payer Core passed in
```

## Runs on

The build reads other contracts in the examples here, so it is staked on the alternative mempool.

## Limits

- Fee caps are unused and must be zero; the factory refuses a caller-pays logic deployed as rule-pays.
