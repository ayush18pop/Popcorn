---
name: "P-256 and WebAuthn passkeys"
group: sign
trigger: people
priority: 10
status: built
runsOn: [alternative]
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

## Runs on

The alternative mempool, which admits validation of any size.

## Code

```ts
// one EIP-712 digest for every scheme: chain, rule contract, rule, epoch, trigger data
const binding = { chainId: BigInt(chain.id), ruleContract, ruleId: 0n, ruleEpoch: 0n, triggerData };
const signature = await signEcdsaIntent(owner, binding);
const hash = await anyone.trigger(ruleContract, { triggerData, verifyData: signature });
```

## Limits

- Reviewed by us, not externally audited.
