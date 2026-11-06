---
name: "Contract Code Changed"
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
presets: ["Upgrade tripwire: exit or pause the moment a protocol you rely on is upgraded"]
sdk: "blocks.contractCodeChanged"
related: [exit-to-an-address, make-a-call]
code: ["contracts/src/blocks/checks/ContractCodeChanged.sol"]
---

# Contract Code Changed

## What it does

Says yes when a contract's code is no longer the code recorded at setup: it was upgraded, re-delegated or replaced.

## Inputs

- **target**: the contract to watch
- **recorded**: its code hash when the build was set up
- **each trigger brings**: nothing
- **answers**: yes / no

## Presets

- Upgrade tripwire: exit or pause the moment a protocol you rely on is upgraded

## Code

```ts
const spec = blocks.build({ when: blocks.contractCodeChanged(pool, recordedHash), then: blocks.makeACall(vault, { data: withdrawAll }) });
```

```solidity
function condition() internal view override returns (bool) {
    return _codeChanged(lendingPool, RECORDED_HASH).isYes();
}
```

## Runs on

Reads code, not storage: the public mempool and the alternative mempool.

## Limits

- A contract that was removed entirely cannot be watched this way: both mempools refuse a read of an account with no code.
- For a proxy, the code is the proxy's: watch the implementation slot with Value Crosses A Line instead.
