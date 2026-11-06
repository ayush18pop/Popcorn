---
name: "ECDSA"
corner: sign
trigger: people
status: built
mempool: { public: true, alt: unstaked }
gas: null
example: null
related: [signed-intent, multisig-signer]
code: ["contracts/src/signers/EcdsaSigner.sol", "packages/sdk/examples/08-signed-intent.ts"]
---

# ECDSA

## What it does

secp256k1, the scheme every wallet has. Signs the EIP-712 intent digest with `eth_signTypedData_v4`.

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

- Reviewed by us, not externally audited.
