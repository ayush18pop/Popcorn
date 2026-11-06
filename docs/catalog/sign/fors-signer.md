---
name: "FORS Signer"
group: sign
trigger: people
priority: 4
status: built
runsOn: [public, alternative]
gas: { validation: 90176, tag: measured, network: local }
example: null
related: [quantum-switch, hybrid-owner-key, signed-intent]
postQuantum: true
code: ["contracts/src/signers/ForsSigner.sol", "contracts/src/conditions/ForsIntentCondition.sol", "packages/sdk/src/fors.ts"]
---

# FORS Signer

## What it does

Forest of Random Subsets: a few-time hash-based signature (the building block inside SPHINCS+). A key may sign a small, fixed number of times; the SDK refuses beyond that budget.

## When it fires

When a signed intent for this rule contract, this rule and its current epoch verifies under the configured key.

## What it does then

The rule's action runs and the epoch advances, so the same signature can never be replayed.

## Runs on

At 90,176 gas of validation (measured, inline form) it fits the public mempool's budget, and the alternative mempool.

## Code

```ts
// one EIP-712 digest for every scheme: chain, rule contract, rule, epoch, trigger data
const witness = signer.sign({ chainId, ruleContract, ruleId: 0n, ruleEpoch, triggerData });
const hash = await anyone.trigger(ruleContract, { triggerData, verifyData: witness }); // sent by a key with no ETH
```

## Limits

- Few-time: security drops with each signature, so the SDK enforces the budget.
- Larger signatures than WOTS+.
- Post-quantum signatures authenticate; they hide nothing from chain observers.
- Reviewed by us, not externally audited.
