---
name: "Call"
shape: action
tier: 1
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "target", what: "any contract" }
  - { name: "data and value", what: "what to call, with how much ETH" }
  - { name: "gas cap", what: "the most the call may use" }
perTrigger: "nothing (or the call itself, in a signed instruction)"
output: "the call happened, or a failure is reported"
useCases:
  ready: ["Account spends: Sovereign Account"]
  configs: ["Swap out of a depegged asset", "Withdraw from a protocol after an upgrade"]
  ideas: []
sdk: "blocks.makeACall"
related: [signature, pause]
code: ["contracts/src/blocks/actions/MakeACall.sol"]
---

# Call

## Overview

Calls any contract from the build. Best effort: a failed call is reported in an event and the action carries on, because the trigger's key is already spent.

## Configuration

- **target**: any contract
- **data and value**: what to call, with how much ETH
- **gas cap**: the most the call may use
- **trigger payload**: nothing (or the call itself, in a signed instruction)
- **effect**: the call happened, or a failure is reported

## Use cases

### Ready to use

- Account spends: Sovereign Account

### Common configurations

- Swap out of a depegged asset
- Withdraw from a protocol after an upgrade

## Usage

```ts
blocks.makeACall(vault, { data: encodeFunctionData({ abi, functionName: "withdrawAll" }), gas: 200_000 })
```

```solidity
_makeCall(to, value, data, 200_000);
```

## Mempool

Actions run after validation, so they do not decide where a build runs.

## Gotchas

- The build pays for a failed call too: cap the gas when the callee is not trusted.
