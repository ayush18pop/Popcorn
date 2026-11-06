---
name: "K-of-N"
shape: join
tier: 3
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "k", what: "how many must say yes" }
  - { name: "checks", what: "n checks" }
perTrigger: "nothing"
output: "yes once k say yes"
useCases:
  ready: []
  configs: ["2 of 3 oracles below the floor"]
  ideas: []
sdk: "blocks.atLeast"
related: [exactly-one, or]
code: ["contracts/src/blocks/Answer.sol"]
---

# K-of-N

## Overview

Yes once at least k of the connected checks say yes; no once too few are left that could still say yes.

## Configuration

- **k**: how many must say yes
- **checks**: n checks
- **trigger payload**: nothing
- **returns**: yes once k say yes

## Use cases

### Common configurations

- 2 of 3 oracles below the floor

## Usage

```ts
blocks.atLeast(2, below(oracleA), below(oracleB), below(oracleC))
```

```solidity
return Join.atLeast(2, Join.list(_oracleA(), _oracleB(), _oracleC())).isYes();
```

## Mempool

As strict as the strictest check inside it.
