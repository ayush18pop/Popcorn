---
name: "None Of"
shape: join
tier: 1
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "checks", what: "one or more checks" }
perTrigger: "nothing"
output: "yes when no check says yes; unknown stays unknown"
presets: ["Reopen only when the vault is healthy again (Proof-of-Exploit Bounty)", "Act only if not already paused"]
sdk: "blocks.noneOf"
related: [all-of, any-of]
code: ["contracts/src/blocks/Answer.sol"]
---

# None Of

## What it does

Yes when none of the connected checks says yes. A check that cannot answer stays unknown here too, so a broken read can never be turned into yes by negation.

## Inputs

- **checks**: one or more checks
- **each trigger brings**: nothing
- **answers**: yes when no check says yes; unknown stays unknown

## Presets

- Reopen only when the vault is healthy again (Proof-of-Exploit Bounty)
- Act only if not already paused

## Code

```ts
blocks.noneOf(blocks.valueCrossesLine(blocks.getter(target, "paused()"), "above", 0n))
```

```solidity
function _safeToReopen() internal view override returns (bool) {
    return Join.noneOf(_belowFloor()).isYes();
}
```

## Runs on

As strict as the strictest check inside it.

## Limits

- A signed instruction or a proof cannot sit under None Of: their no only means the signature or proof failed.
