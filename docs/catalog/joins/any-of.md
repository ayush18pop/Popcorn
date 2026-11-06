---
name: "Any Of"
shape: join
tier: 1
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "checks", what: "two or more checks" }
perTrigger: "which check is true (a hint the sender gives)"
output: "yes when one check says yes"
presets: ["Oracle too low or too high", "The oracle, or the reporters"]
sdk: "blocks.anyOf"
related: [all-of, at-least-k-of-n]
code: ["contracts/src/blocks/Answer.sol"]
---

# Any Of

## What it does

Yes when at least one connected check says yes. The sender names which one; a wrong name can only make the answer no, so it cannot be abused.

## Inputs

- **checks**: two or more checks
- **each trigger brings**: which check is true (a hint the sender gives)
- **answers**: yes when one check says yes

## Presets

- Oracle too low or too high
- The oracle, or the reporters

## Code

```ts
blocks.anyOf(blocks.valueCrossesLine(price, "below", lo), blocks.valueCrossesLine(price, "above", hi))
```

```solidity
return Join.anyOf(_tooLow(), _tooHigh()).isYes();
```

## Runs on

As strict as the strictest check inside it.
