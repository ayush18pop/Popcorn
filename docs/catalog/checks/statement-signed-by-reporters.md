---
name: "Statement Signed By k Of n Reporters"
shape: check
tier: 3
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "statement", what: "a hash of the fact, agreed off chain (\"ETH/USD below 1,800\", \"the bridge halted\")" }
  - { name: "k and reporters", what: "how many of which reporters must sign" }
perTrigger: "k signatures (verify data)"
output: "yes / no / unknown"
presets: ["Second opinion next to an oracle (All Of)", "An off-chain event: a bridge halt, a court order, a receipt"]
sdk: "blocks.reportersSigned"
related: [value-crosses-a-line, all-of, signed-instruction]
code: ["contracts/src/blocks/checks/ReporterStatement.sol"]
---

# Statement Signed By k Of n Reporters

## What it does

Yes when at least k of n named reporters signed that a statement holds for this exact trigger. Use it for facts that are not on chain, or next to Value Crosses A Line so that one manipulated oracle is not enough.

## Inputs

- **statement**: a hash of the fact, agreed off chain ("ETH/USD below 1,800", "the bridge halted")
- **k and reporters**: how many of which reporters must sign
- **each trigger brings**: k signatures (verify data)
- **answers**: yes / no / unknown

## Presets

- Second opinion next to an oracle (All Of)
- An off-chain event: a bridge halt, a court order, a receipt

## Code

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

## Runs on

The signatures are checked by a stateless signer contract: public mempool for a few ECDSA reporters.

## Limits

- Reporters are trusted for the statement they sign; choose k so that no single reporter decides.
