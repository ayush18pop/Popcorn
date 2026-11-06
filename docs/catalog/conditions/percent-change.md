---
name: "Percent Change"
shape: check
tier: 3
status: built
runsOn: [public, alternative-staked]
gas: null
inputs:
  - { name: "value", what: "where the number comes from (as in Compare)" }
  - { name: "bps", what: "how far it may move, in basis points" }
  - { name: "move", what: "up, down or either" }
  - { name: "baseline", what: "the value to measure from; the build moves it forward each time it fires" }
perTrigger: "nothing"
output: "yes / no / unknown"
useCases:
  ready: []
  configs: ["Outflow spike: assets down 20% since the last check", "Price jump: 10% either way"]
  ideas: ["Token supply minted faster than expected"]
sdk: "blocks.valueMovesTooFast"
related: [compare, pause]
code: ["contracts/src/blocks/checks/ValueMovesTooFast.sol"]
---

# Percent Change

## Overview

Has a number moved more than a set percentage from where it was last time? The block remembers the last value in the build's own storage and measures from it.

## Configuration

- **value**: where the number comes from (as in Compare)
- **bps**: how far it may move, in basis points
- **move**: up, down or either
- **baseline**: the value to measure from; the build moves it forward each time it fires
- **trigger payload**: nothing
- **returns**: yes / no / unknown

## Use cases

### Common configurations

- Outflow spike: assets down 20% since the last check
- Price jump: 10% either way

### Other use cases (not built)

- Token supply minted faster than expected

## Usage

```ts
const spec = blocks.build({
  when: blocks.valueMovesTooFast(blocks.getter(vault, "totalAssets()"), 2_000, "down", { initial: await currentAssets() }),
  then: blocks.pauseTarget(vault),
});
```

```solidity
function condition() internal view override returns (bool) {
    return _movedTooFast(0, _assets(), 2_000, Move.Down).isYes(); // 20% down
}
function action() internal override {
    _rememberValue(0, _assets()); // measure the next move from here
    _pauseSelf();
}
```

## Mempool

Measuring the build's own storage runs on the public mempool; measuring another contract needs a staked build.

## Gotchas

- Until a baseline is set the answer is no, so a fresh build never fires on its first reading.
