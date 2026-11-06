---
name: "K-of-N Attestation"
shape: check
tier: 3
status: built
runsOn: [alternative]
gas: null
inputs:
  - { name: "statement", what: "a hash of the fact, agreed off chain (\"ETH/USD below 1,800\", \"the bridge halted\")" }
  - { name: "k and reporters", what: "how many of which reporters must sign" }
perTrigger: "k signatures (verify data)"
output: "yes / no / unknown"
useCases:
  ready: []
  configs: ["Second opinion next to an oracle (AND with Compare)"]
  ideas: ["A bridge halt reported by 3 of 5 watchers", "An off-chain receipt or court order"]
sdk: "blocks.reportersSigned"
related: [compare, and, signature]
code: ["contracts/src/blocks/checks/ReporterStatement.sol"]
---

# K-of-N Attestation

## Overview

Yes when at least k of n named reporters signed that a statement holds for this exact trigger. Use it for facts that are not on chain, or next to Compare so that one manipulated oracle is not enough.

## Configuration

- **statement**: a hash of the fact, agreed off chain ("ETH/USD below 1,800", "the bridge halted")
- **k and reporters**: how many of which reporters must sign
- **trigger payload**: k signatures (verify data)
- **returns**: yes / no / unknown

## Use cases

### Common configurations

- Second opinion next to an oracle (AND with Compare)

### Other use cases (not built)

- A bridge halt reported by 3 of 5 watchers
- An off-chain receipt or court order

## Usage

```ts
const spec = blocks.build({
  when: blocks.allOf(blocks.valueOutsideBand(blocks.getter(oracle, "price()"), lo, hi), blocks.reportersSigned(attestedFactSigner, PEG_BROKEN, 2, reporters)),
  then: blocks.makeACall(treasury, { data: exitToSafeAsset }),
});
```

```solidity
function condition(bytes calldata data, bytes calldata sigs) internal view override returns (bool) {
    return _reportersSay(attestedFactSigner, PEG_BROKEN, 2, reporters, 0, data, sigs).isYes();
}
```

## Mempool

The signatures are checked by a stateless signer contract that reads no storage, so no stake is needed; it has been run on the alternative mempool.

## Gotchas

- Reporters are trusted for the statement they sign; choose k so that no single reporter decides.
