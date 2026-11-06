---
name: "Hybrid Owner Key"
group: sign
trigger: people
priority: 4
status: built
runsOn: [public, alternative]
gas: null
example: examples/sign/sovereign-account/run.json
related: [signed-intent, multisig-signer]
postQuantum: true
code: ["contracts/src/signers/HybridEcdsaWotsSigner.sol", "packages/sdk/examples/08-signed-intent.ts"]
---

# Hybrid Owner Key

## What it does

Owner actions need an ECDSA and a WOTS+ signature over the same hash, with two-step rotation.

## When it fires

When a signed intent for this rule contract, this rule and its current epoch verifies under the configured key.

## What it does then

The rule's action runs and the epoch advances, so the same signature can never be replayed.

## Runs on

ECDSA plus WOTS+ over the same hash, keys in the contract's own storage: the public mempool and the alternative mempool.

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
