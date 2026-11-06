---
name: "WOTS+"
corner: sign
trigger: people
status: built
mempool: { public: true, alt: unstaked }
gas: null
example: null
related: [signed-intent, multisig-signer]
postQuantum: true
code: ["contracts/src/signers/WotsSigner.sol", "packages/sdk/examples/08-signed-intent.ts"]
---

# WOTS+

## What it does

A one-time hash-based signature. The epoch picks the leaf, so each leaf signs once by construction. Fits the public budget.

## When it fires

When a signed intent for this rule contract, this rule and its current epoch verifies under the configured key.

## What it does then

The rule's action runs and the epoch advances, so the same signature can never be replayed.

## Mempool

Fits the public 100,000 gas of validation.

## Code

```ts
// one EIP-712 digest for every scheme: chain, rule contract, rule, epoch, trigger data
const binding = { chainId: BigInt(chain.id), ruleContract, ruleId: 0n, ruleEpoch: 0n, triggerData };
const signature = await signEcdsaIntent(owner, binding);
const hash = await anyone.trigger(ruleContract, { triggerData, verifyData: signature });
```

## Limits

- One-time and few-time keys never sign twice: the SDK records each digest before returning a signature.
- Reviewed by us, not externally audited.
