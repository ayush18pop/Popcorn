---
name: "Self-Paying"
shape: payer
tier: 1
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "balance", what: "ETH the build holds" }
  - { name: "fee caps", what: "the most it pays per gas" }
perTrigger: "nothing: no signature, no account"
output: "the build pays for every valid trigger"
useCases:
  ready: ["Every recorded example except Open Gas Network"]
  configs: []
  ideas: []
sdk: "deployRule"
related: [caller-pays, paymaster]
code: ["contracts/src/payers/RulePays.sol"]
---

# Self-Paying

## Overview

The build pays for its own triggers, so anyone can send one from a wallet with no ETH, and an invalid trigger is never included and costs nothing.

## Configuration

- **balance**: ETH the build holds
- **fee caps**: the most it pays per gas
- **trigger payload**: nothing: no signature, no account
- **effect**: the build pays for every valid trigger

## Use cases

### Ready to use

- Every recorded example except Open Gas Network

## Usage

```ts
const { ruleContract } = await deployer.deployRule({ logic: { bytecode }, fund: parseEther("0.01") });
const hash = await anyone.trigger(ruleContract); // no account, no ETH
```

```solidity
contract MyBuild is PauseTarget, RulePays { ... }
```

## Mempool

The public mempool and the alternative mempool.

## Gotchas

- Keep the balance at or above the worst-case cost of one trigger (maxCostPerTrigger).
