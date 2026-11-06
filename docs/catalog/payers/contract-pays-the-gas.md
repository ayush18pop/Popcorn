---
name: "Contract Pays The Gas"
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
presets: ["Whitehat claims from a fresh key (Proof-of-Exploit Bounty)", "An account that pays its own gas (Sovereign Account)"]
sdk: "deployRule"
related: [payer-gets-rewarded, public-gas-sponsor]
code: ["contracts/src/payers/RulePays.sol"]
---

# Contract Pays The Gas

## What it does

The build pays for its own triggers, so anyone can send one from a wallet with no ETH, and an invalid trigger is never included and costs nothing.

## Inputs

- **balance**: ETH the build holds
- **fee caps**: the most it pays per gas
- **each trigger brings**: nothing: no signature, no account
- **result**: the build pays for every valid trigger

## Presets

- Whitehat claims from a fresh key (Proof-of-Exploit Bounty)
- An account that pays its own gas (Sovereign Account)

## Code

```ts
const { ruleContract } = await deployer.deployRule({ logic: { bytecode }, fund: parseEther("0.01") });
const hash = await anyone.trigger(ruleContract); // no account, no ETH
```

```solidity
contract MyBuild is PauseTarget, RulePays { ... }
```

## Runs on

The public mempool and the alternative mempool.

## Limits

- Keep the balance at or above the worst-case cost of one trigger (maxCostPerTrigger).
