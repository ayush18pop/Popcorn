---
name: "Signed Intent"
group: sign
trigger: people
priority: 5
status: built
runsOn: [public, alternative]
gas: null
example: examples/sign/sovereign-account/run.json
related: [post-quantum-signer, passkey-signer, multisig-signer]
code: ["contracts/src/conditions/SignedIntentCondition.sol", "packages/sdk/examples/08-signed-intent.ts"]
---

# Signed Intent

## What it does

A rule fires when an authorised key signs an intent for it, bound to the rule's epoch so it cannot be replayed. The default key is ECDSA (secp256k1, signed with `eth_signTypedData_v4`, which every wallet has); passkeys, multisig and post-quantum schemes plug into the same digest.

## When it fires

When the signature over the intent digest verifies.

## What it does then

Runs the rule's action and advances its epoch.

## Runs on

Inline ECDSA and WOTS+ keep the key in immutables: the public mempool and the alternative mempool.

## Code

```ts
const signature = await signEcdsaIntent(owner, { chainId, ruleContract, ruleId: 0n, ruleEpoch: 0n, triggerData });
const hash = await anyone.trigger(ruleContract, { triggerData, verifyData: signature });
const again = await anyone.canTrigger(ruleContract, { triggerData, verifyData: signature }); // refused: epoch moved
```

## Limits

- Replay protection lives in the rule contract's epoch, not in the signature.
