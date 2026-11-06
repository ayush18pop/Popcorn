---
name: "Value Moves Too Fast"
shape: check
tier: 3
status: built
runsOn: [public, alternative-staked]
gas: null
inputs:
  - { name: "value", what: "where the number comes from (as in Value Crosses A Line)" }
  - { name: "bps", what: "how far it may move, in basis points" }
  - { name: "move", what: "up, down or either" }
  - { name: "baseline", what: "the value to measure from; the build moves it forward each time it fires" }
perTrigger: "nothing"
output: "yes / no / unknown"
presets: ["Outflow spike: assets fell 20% since the last check", "Price jump", "Supply mint spike"]
sdk: "blocks.valueMovesTooFast"
related: [value-crosses-a-line, pause-the-target]
code: ["contracts/src/blocks/checks/ValueMovesTooFast.sol"]
---

# Value Moves Too Fast

## What it does

Has a number moved more than a set percentage from where it was last time? The block remembers the last value in the build's own storage and measures from it.

## Inputs

- **value**: where the number comes from (as in Value Crosses A Line)
- **bps**: how far it may move, in basis points
- **move**: up, down or either
- **baseline**: the value to measure from; the build moves it forward each time it fires
- **each trigger brings**: nothing
- **answers**: yes / no / unknown

## Presets

- Outflow spike: assets fell 20% since the last check
- Price jump
- Supply mint spike

## Code

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

## Runs on

Measuring the build's own storage runs on the public mempool; measuring another contract needs a staked build.

## Limits

- Until a baseline is set the answer is no, so a fresh build never fires on its first reading.
