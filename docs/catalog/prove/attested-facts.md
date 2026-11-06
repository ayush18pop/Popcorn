---
name: "Attested Facts"
group: prove
trigger: people
priority: 3
status: built
runsOn: [alternative]
gas: null
example: null
related: [signed-intent, multisig-signer]
code: ["contracts/src/signers/AttestedFactSigner.sol", "packages/sdk/examples/08-signed-intent.ts"]
---

# Attested Facts

## What it does

k-of-n signers attest to a fact (a price, an event); the rule fires on the attested value.

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
