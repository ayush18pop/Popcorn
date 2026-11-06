---
name: "All Of"
shape: join
tier: 1
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "checks", what: "two or more checks" }
perTrigger: "nothing"
output: "yes when every check says yes; no if any says no; otherwise unknown"
presets: ["An oracle and the reporters agree", "Below the floor and not already paused"]
sdk: "blocks.allOf"
related: [any-of, none-of]
code: ["contracts/src/blocks/Answer.sol"]
---

# All Of

## What it does

Yes when every connected check says yes. One no is enough for no; a check that cannot answer makes the whole answer unknown, never yes.

## Inputs

- **checks**: two or more checks
- **each trigger brings**: nothing
- **answers**: yes when every check says yes; no if any says no; otherwise unknown

## Presets

- An oracle and the reporters agree
- Below the floor and not already paused

## Code

```ts
blocks.allOf(blocks.valueCrossesLine(price, "below", floor), blocks.reportersSigned(signer, ST, 2, reporters))
```

```solidity
return Join.allOf(_belowFloor(), Join.noneOf(_alreadyPaused())).isYes();
```

## Runs on

As strict as the strictest check inside it.
