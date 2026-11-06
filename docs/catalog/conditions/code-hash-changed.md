---
name: "Code Hash Changed"
shape: check
tier: 3
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "target", what: "the contract to watch" }
  - { name: "recorded", what: "its code hash when the build was set up" }
perTrigger: "nothing"
output: "yes / no"
useCases:
  ready: []
  configs: ["Upgrade tripwire on a contract you depend on"]
  ideas: ["Withdraw from a protocol the moment its code is replaced (with Withdraw All)"]
sdk: "blocks.contractCodeChanged"
related: [withdraw-all, call]
code: ["contracts/src/blocks/checks/ContractCodeChanged.sol"]
---

# Code Hash Changed

## Overview

Says yes when a contract's code is no longer the code recorded at setup: it was upgraded, re-delegated or replaced.

## Configuration

- **target**: the contract to watch
- **recorded**: its code hash when the build was set up
- **trigger payload**: nothing
- **returns**: yes / no

## Use cases

### Common configurations

- Upgrade tripwire on a contract you depend on

### Other use cases (not built)

- Withdraw from a protocol the moment its code is replaced (with Withdraw All)

## Usage

```ts
const spec = blocks.build({ when: blocks.contractCodeChanged(pool, recordedHash), then: blocks.makeACall(vault, { data: withdrawAll }) });
```

```solidity
function condition() internal view override returns (bool) {
    return _codeChanged(lendingPool, RECORDED_HASH).isYes();
}
```

## Mempool

Reads code, not storage: the public mempool and the alternative mempool.

## Gotchas

- A contract that was removed entirely cannot be watched this way: both mempools refuse a read of an account with no code.
- For a proxy, the code is the proxy's: watch the implementation slot with Compare instead.
