---
name: "NOT / NOR"
shape: join
tier: 1
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "checks", what: "one or more checks" }
perTrigger: "nothing"
output: "yes when no check says yes; unknown stays unknown"
useCases:
  ready: ["Reopen only when NOT below the floor: Proof-of-Exploit Bounty"]
  configs: ["Act only if NOT already paused"]
  ideas: []
sdk: "blocks.noneOf"
related: [and, or]
code: ["contracts/src/blocks/Answer.sol"]
---

# NOT / NOR

## Overview

Yes when none of the connected checks says yes. A check that cannot answer stays unknown here too, so a broken read can never be turned into yes by negation.

## Configuration

- **checks**: one or more checks
- **trigger payload**: nothing
- **returns**: yes when no check says yes; unknown stays unknown

## Use cases

### Ready to use

- Reopen only when NOT below the floor: Proof-of-Exploit Bounty

### Common configurations

- Act only if NOT already paused

## Usage

```ts
blocks.noneOf(blocks.valueCrossesLine(blocks.getter(target, "paused()"), "above", 0n))
```

```solidity
function _safeToReopen() internal view override returns (bool) {
    return Join.noneOf(_belowFloor()).isYes();
}
```

## Mempool

As strict as the strictest check inside it.

## Gotchas

- A signed instruction or a proof cannot sit under NOT: their no only means the signature or proof failed.
