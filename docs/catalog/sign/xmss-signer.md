---
name: "XMSS-style"
corner: sign
trigger: people
status: built
mempool: { public: false, alt: unstaked }
gas: null
example: null
related: [signed-intent, multisig-signer]
postQuantum: true
code: ["contracts/src/signers/XmssSigner.sol", "packages/sdk/examples/08-signed-intent.ts"]
---

# XMSS-style

## What it does

A Merkle tree of one-time keys: many signatures under one public root.

## When it fires

When a signed intent for this rule contract, this rule and its current epoch verifies under the configured key.

## What it does then

The rule's action runs and the epoch advances, so the same signature can never be replayed.

## Mempool

Validation goes above the public 100,000; the local devnet's 250,000 budget admits it.

## Code

```ts
// one EIP-712 digest for every scheme: chain, rule contract, rule, epoch, trigger data
const binding = { chainId: BigInt(chain.id), ruleContract, ruleId: 0n, ruleEpoch: 0n, triggerData };
const signature = await signEcdsaIntent(owner, binding);
const hash = await anyone.trigger(ruleContract, { triggerData, verifyData: signature });
```

## Limits

- One-time and few-time keys never sign twice: the SDK records each digest before returning a signature.
- Above the public 100,000 gas: run it on the local devnet or a network with a larger budget.
- Reviewed by us, not externally audited.
