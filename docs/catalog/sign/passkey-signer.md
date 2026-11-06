---
name: "P-256 and WebAuthn passkeys"
corner: sign
trigger: people
status: built
mempool: { public: false, alt: unstaked }
gas: null
example: null
related: [signed-intent, multisig-signer]
code: ["contracts/src/signers/WebAuthnSigner.sol", "packages/sdk/examples/08-signed-intent.ts"]
---

# P-256 and WebAuthn passkeys

## What it does

Passkeys from a phone or laptop through the P256VERIFY precompile. Rejects high-s signatures and fails closed without the precompile.

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

- Above the public 100,000 gas: run it on the local devnet or a network with a larger budget.
- Reviewed by us, not externally audited.
