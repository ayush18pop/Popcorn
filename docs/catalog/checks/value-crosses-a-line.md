---
name: "Value Crosses A Line"
shape: check
tier: 1
status: built
runsOn: [public, alternative-staked]
gas: null
inputs:
  - { name: "value", what: "where the number comes from: a slot of the build's own storage, a getter on another contract (with an argument and a word index), or two numbers as a ratio" }
  - { name: "line", what: "the line, or two lines for a band" }
  - { name: "side", what: "above or below (or outside the band)" }
perTrigger: "nothing"
output: "yes / no / unknown (a read that fails is unknown)"
presets: ["Share price below a floor (Proof-of-Exploit Bounty's watch)", "Loan health factor below 1.1 (Auto-Repay Loan)", "Two oracles more than 5% apart", "A stablecoin outside its peg band"]
sdk: "blocks.valueCrossesLine"
related: [value-moves-too-fast, none-of, pause-the-target]
code: ["contracts/src/blocks/checks/ValueCrossesLine.sol"]
---

# Value Crosses A Line

## What it does

Is a number above or below a line? The number can come from the build's own storage, from another contract, or be a ratio of two numbers compared without division, so nothing rounds.

## Inputs

- **value**: where the number comes from: a slot of the build's own storage, a getter on another contract (with an argument and a word index), or two numbers as a ratio
- **line**: the line, or two lines for a band
- **side**: above or below (or outside the band)
- **each trigger brings**: nothing
- **answers**: yes / no / unknown (a read that fails is unknown)

## Presets

- Share price below a floor (Proof-of-Exploit Bounty's watch)
- Loan health factor below 1.1 (Auto-Repay Loan)
- Two oracles more than 5% apart
- A stablecoin outside its peg band

## Code

```ts
const { build, valueCrossesLine, getter, pauseTarget } = blocks;
const spec = build({ when: valueCrossesLine(getter(oracle, "price()"), "below", floor), then: pauseTarget(pool) });
const { ruleContract } = await deployRuleSet(client.popcorn, spec, { fund, stake: true });
```

```solidity
contract MyGuard is ValueCrossesLine, PauseTarget, RulePays {
    function condition() internal view override returns (bool) {
        return _getterCrossesLine(oracle, abi.encodeWithSignature("price()"), 0, 30_000, floor, Side.Below).isYes();
    }
}
```

## Runs on

Reading the build's own storage runs on the public mempool. Reading another contract needs a staked build on the alternative mempool.

## Limits

- A getter read is capped by its own gas; a read over the cap is unknown, so it never fires.
