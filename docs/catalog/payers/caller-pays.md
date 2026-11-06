---
name: "Caller Pays"
shape: payer
tier: 2
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "reward", what: "token and amount, from the build" }
perTrigger: "the payer's approval (it signs the whole transaction)"
output: "the payer is paid; a copier would have to pay the gas itself"
useCases:
  ready: ["The app account the sponsor pays for: Open Gas Network", "Keepers who rescue a loan: Auto-Repay Loan (tested build)"]
  configs: []
  ideas: []
sdk: "trigger({ payer })"
related: [self-paying, repay]
code: ["contracts/src/payers/CallerPays.sol"]
---

# Caller Pays

## Overview

Whoever pays the gas for a trigger earns a reward from the build. The reward goes to the account that actually paid, never to a name in the trigger data, so copying a pending trigger gains nothing.

## Configuration

- **reward**: token and amount, from the build
- **trigger payload**: the payer's approval (it signs the whole transaction)
- **effect**: the payer is paid; a copier would have to pay the gas itself

## Use cases

### Ready to use

- The app account the sponsor pays for: Open Gas Network
- Keepers who rescue a loan: Auto-Repay Loan (tested build)

## Usage

```ts
const hash = await client.trigger(ruleContract, { payer: account });
```

```solidity
_payReward(address(token), reward); // to the payer Core passed in
```

## Mempool

The payer's own verification approves payment and the build approves execution, each reading only its own storage: the public mempool and the alternative mempool. A build whose checks read other contracts (Auto-Repay Loan) needs a stake.

## Gotchas

- Fee caps are unused and must be zero; the factory refuses a caller-pays logic deployed as rule-pays.
