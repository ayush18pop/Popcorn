---
name: "XMSS Signer"
group: sign
trigger: people
priority: 2
status: built
runsOn: [public, alternative]
gas: { validation: 94076, tag: measured, network: local }
example: null
related: [quantum-switch, hybrid-owner-key, signed-intent]
postQuantum: true
code: ["contracts/src/signers/XmssSigner.sol", "contracts/src/conditions/XmssIntentCondition.sol", "packages/sdk/src/xmss.ts"]
---

# XMSS Signer

## What it does

A Merkle tree of WOTS+ one-time keys (height 10): many post-quantum signatures under one public root, each from a fresh leaf, in the style of XMSS (RFC 8391).

## When it fires

When a signed intent for this rule contract, this rule and its current epoch verifies under the configured key.

## What it does then

The rule's action runs and the epoch advances, so the same signature can never be replayed.

## Runs on

At 94,076 gas of validation (measured, inline form) it fits the public mempool's budget, and the alternative mempool.

## Code

```ts
// one EIP-712 digest for every scheme: chain, rule contract, rule, epoch, trigger data
const witness = signer.sign({ chainId, ruleContract, ruleId: 0n, ruleEpoch, triggerData });
const hash = await anyone.trigger(ruleContract, { triggerData, verifyData: witness }); // sent by a key with no ETH
```

## Limits

- Stateful: the signer must never reuse a leaf; the SDK records each one before signing.
- A keccak construction in XMSS style, not the RFC's exact encoding.
- Post-quantum signatures authenticate; they hide nothing from chain observers.
- Reviewed by us, not externally audited.
