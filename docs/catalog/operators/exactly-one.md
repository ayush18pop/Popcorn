---
name: "EXACTLY ONE"
shape: join
tier: 3
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "checks", what: "two or more checks (or exactly k of n)" }
perTrigger: "nothing"
output: "yes when exactly one says yes and none is unknown"
useCases:
  ready: []
  configs: ["Exactly one of two keepers reports"]
  ideas: ["One route chosen, never two"]
sdk: "blocks.exactlyOne"
related: [k-of-n, not]
code: ["contracts/src/blocks/Answer.sol"]
---

# EXACTLY ONE

## Overview

Yes when exactly one of the connected checks says yes. Every other check must say a definite no, so one that cannot answer makes the result unknown, never yes.

## Configuration

- **checks**: two or more checks (or exactly k of n)
- **trigger payload**: nothing
- **returns**: yes when exactly one says yes and none is unknown

## Use cases

### Common configurations

- Exactly one of two keepers reports

### Other use cases (not built)

- One route chosen, never two

## Usage

```ts
blocks.exactlyOne(blocks.valueCrossesLine(a, "above", x), blocks.valueCrossesLine(b, "above", y))
```

```solidity
return Join.exactlyOne(Join.list(_routeA(), _routeB())).isYes();
```

## Mempool

As strict as the strictest check inside it.

## Gotchas

- A signed instruction or a proof cannot sit under it (their no is not exact).
