---
name: "IF / ELSE"
shape: join
tier: 3
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "rules", what: "an ordered list of checks, each with its action" }
perTrigger: "which rule (trigger data)"
output: "rule i fires only when its check is yes and every earlier check is a definite no"
useCases:
  ready: ["High / medium / default responses to one number: SDK example 07"]
  configs: ["Escalating responses: warn, then pause"]
  ideas: []
sdk: "blocks.buildIfElse"
related: [or, and]
code: ["contracts/src/blocks/Answer.sol"]
---

# IF / ELSE

## Overview

Ordered rules: the first rule whose check says yes is the one that may fire, and only when every earlier check says a definite no.

## Configuration

- **rules**: an ordered list of checks, each with its action
- **trigger payload**: which rule (trigger data)
- **returns**: rule i fires only when its check is yes and every earlier check is a definite no

## Use cases

### Ready to use

- High / medium / default responses to one number: SDK example 07

### Common configurations

- Escalating responses: warn, then pause

## Usage

```ts
blocks.buildIfElse({ when: above(v, 100n), then: pauseTarget(p) }, { when: above(v, 10n), then: makeACall(alarm) })
```

```solidity
Answer r = Join.ifElse(_severe(), _pauseAnswer(), _warnAnswer());
```

## Mempool

As strict as the strictest check inside it.

## Gotchas

- Earlier checks are evaluated exactly, so a signed instruction can only be in the last rule.
