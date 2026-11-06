---
name: "At Least k Of n"
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
presets: ["Two of three oracles below the floor"]
sdk: "blocks.atLeast"
related: [exactly-one-of, any-of]
code: ["contracts/src/blocks/Answer.sol"]
---

# At Least k Of n

## What it does

Yes once at least k of the connected checks say yes; no once too few are left that could still say yes.

## Inputs

- **k**: how many must say yes
- **checks**: n checks
- **each trigger brings**: nothing
- **answers**: yes once k say yes

## Presets

- Two of three oracles below the floor

## Code

```ts
blocks.atLeast(2, below(oracleA), below(oracleB), below(oracleC))
```

```solidity
return Join.atLeast(2, Join.list(_oracleA(), _oracleB(), _oracleC())).isYes();
```

## Runs on

As strict as the strictest check inside it.
