---
name: "AND"
shape: join
tier: 1
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "checks", what: "two or more checks" }
perTrigger: "nothing"
output: "yes when every check says yes; no if any says no; otherwise unknown"
useCases:
  ready: ["Gauge above 100 AND target not paused: SDK blocks devnet test"]
  configs: ["Oracle AND reporters agree"]
  ideas: []
sdk: "blocks.allOf"
related: [or, not]
code: ["contracts/src/blocks/Answer.sol"]
---

# AND

## Overview

Yes when every connected check says yes. One no is enough for no; a check that cannot answer makes the whole answer unknown, never yes.

## Configuration

- **checks**: two or more checks
- **trigger payload**: nothing
- **returns**: yes when every check says yes; no if any says no; otherwise unknown

## Use cases

### Ready to use

- Gauge above 100 AND target not paused: SDK blocks devnet test

### Common configurations

- Oracle AND reporters agree

## Usage

```ts
blocks.allOf(blocks.valueCrossesLine(price, "below", floor), blocks.reportersSigned(signer, ST, 2, reporters))
```

```solidity
return Join.allOf(_belowFloor(), Join.noneOf(_alreadyPaused())).isYes();
```

## Mempool

As strict as the strictest check inside it.
