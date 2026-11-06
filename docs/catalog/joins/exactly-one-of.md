---
name: "Exactly One Of"
shape: join
tier: 3
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "checks", what: "two or more checks (or exactly k of n)" }
perTrigger: "nothing"
output: "yes when exactly one says yes and none is unknown"
presets: ["Exactly one of two keepers reports", "One route chosen, never two"]
sdk: "blocks.exactlyOne"
related: [at-least-k-of-n, none-of]
code: ["contracts/src/blocks/Answer.sol"]
---

# Exactly One Of

## What it does

Yes when exactly one of the connected checks says yes. Every other check must say a definite no, so one that cannot answer makes the result unknown, never yes.

## Inputs

- **checks**: two or more checks (or exactly k of n)
- **each trigger brings**: nothing
- **answers**: yes when exactly one says yes and none is unknown

## Presets

- Exactly one of two keepers reports
- One route chosen, never two

## Code

```ts
blocks.exactlyOne(blocks.valueCrossesLine(a, "above", x), blocks.valueCrossesLine(b, "above", y))
```

```solidity
return Join.exactlyOne(Join.list(_routeA(), _routeB())).isYes();
```

## Runs on

As strict as the strictest check inside it.

## Limits

- A signed instruction or a proof cannot sit under it (their no is not exact).
