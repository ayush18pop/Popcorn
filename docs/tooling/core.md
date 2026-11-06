---
name: "Popcorn Core"
corner: build
trigger: tooling
status: built
mempool: { public: true, alt: unstaked }
gas: null
example: examples/gas/rule-pays-counter/run.json
related: [rule-pays, caller-pays]
code: ["contracts/core/PopcornCore.yul", "contracts/core/SPEC.md", "contracts/core/LAYOUT.md"]
---

# Popcorn Core

## What it does

The hardened account code under every rule contract: one frame layout, fee caps, once per event, a re-entry lock.

## When it fires

On every trigger, before the developer's condition runs.

## What it does then

Delegates the condition and the action to the developer's logic, in the rule contract's own storage.

## Mempool

Core itself only checks the frame layout, caps and the nonce key.

## Code

```sh
deployed code = PopcornCore.runtime ++ args (101 bytes)
args = logic · mode · maxFeePerGas · maxPriorityFeePerGas · maxGasPerFrame
     · maxStateGasPerFrame · verifier · conditionGas · maxVerifyDataLength · maxTriggerDataLength
```

## Limits

- Reviewed by us, not externally audited.
