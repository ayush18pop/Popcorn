---
name: "OR"
shape: join
tier: 1
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "checks", what: "two or more checks" }
perTrigger: "which check is true (a hint the sender gives)"
output: "yes when one check says yes"
useCases:
  ready: []
  configs: ["Price too low OR too high"]
  ideas: ["The oracle OR the reporters"]
sdk: "blocks.anyOf"
related: [and, k-of-n]
code: ["contracts/src/blocks/Answer.sol"]
---

# OR

## Overview

Yes when at least one connected check says yes. The sender names which one; a wrong name can only make the answer no, so it cannot be abused.

## Configuration

- **checks**: two or more checks
- **trigger payload**: which check is true (a hint the sender gives)
- **returns**: yes when one check says yes

## Use cases

### Common configurations

- Price too low OR too high

### Other use cases (not built)

- The oracle OR the reporters

## Usage

```ts
blocks.anyOf(blocks.valueCrossesLine(price, "below", lo), blocks.valueCrossesLine(price, "above", hi))
```

```solidity
return Join.anyOf(_tooLow(), _tooHigh()).isYes();
```

## Mempool

As strict as the strictest check inside it.
