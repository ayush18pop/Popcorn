---
name: "If / Else"
shape: join
tier: 3
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "rules", what: "an ordered list of checks, each with its action" }
perTrigger: "which rule (trigger data)"
output: "rule i fires only when its check is yes and every earlier check is a definite no"
presets: ["High / medium / default responses to one number"]
sdk: "blocks.buildIfElse"
related: [any-of, all-of]
code: ["contracts/src/blocks/Answer.sol"]
---

# If / Else

## What it does

Ordered rules: the first rule whose check says yes is the one that may fire, and only when every earlier check says a definite no.

## Inputs

- **rules**: an ordered list of checks, each with its action
- **each trigger brings**: which rule (trigger data)
- **answers**: rule i fires only when its check is yes and every earlier check is a definite no

## Presets

- High / medium / default responses to one number

## Code

```ts
blocks.buildIfElse({ when: above(v, 100n), then: pauseTarget(p) }, { when: above(v, 10n), then: makeACall(alarm) })
```

```solidity
Answer r = Join.ifElse(_severe(), _pauseAnswer(), _warnAnswer());
```

## Runs on

As strict as the strictest check inside it.

## Limits

- Earlier checks are evaluated exactly, so a signed instruction can only be in the last rule.
