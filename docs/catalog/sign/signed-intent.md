---
name: "Signed Intent"
corner: sign
trigger: people
status: built
mempool: { public: true, alt: unstaked }
gas: null
example: null
related: [ecdsa-signer, wots-signer]
code: ["contracts/src/conditions/SignedIntentCondition.sol", "packages/sdk/examples/08-signed-intent.ts"]
---

# Signed Intent

## What it does

A rule fires when an authorised key signs an intent for it, bound to the rule's epoch so it cannot be replayed.

## When it fires

When the signature over the intent digest verifies.

## What it does then

Runs the rule's action and advances its epoch.

## Mempool

Inline ECDSA and WOTS+ conditions keep the key as immutables and fit 100,000 gas.

## Code

```ts
const signature = await signEcdsaIntent(owner, { chainId, ruleContract, ruleId: 0n, ruleEpoch: 0n, triggerData });
const hash = await anyone.trigger(ruleContract, { triggerData, verifyData: signature });
const again = await anyone.canTrigger(ruleContract, { triggerData, verifyData: signature }); // refused: epoch moved
```

## Limits

- Replay protection lives in the rule contract's epoch, not in the signature.
