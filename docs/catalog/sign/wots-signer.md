---
name: "WOTS+ Signer"
group: sign
trigger: people
priority: 1
status: built
runsOn: [public, alternative]
gas: { validation: 93765, tag: measured, network: local }
example: examples/sign/quantum-ready-treasury/run.json
related: [quantum-switch, hybrid-owner-key, signed-intent]
postQuantum: true
code: ["contracts/src/signers/WotsSigner.sol", "contracts/src/conditions/WotsIntentCondition.sol", "packages/sdk/src/wots.ts", "packages/sdk/examples/09-pq-intent.ts"]
---

# WOTS+ Signer

## What it does

Winternitz one-time signatures over keccak: a quantum computer cannot forge them. A Merkle tree of 1,024 one-time keys sits under one public root, and the rule's epoch picks the leaf, so each key signs exactly once by construction. Core's own owner key is ECDSA plus WOTS+.

## When it fires

When a signed intent for this rule contract, this rule and its current epoch verifies under the configured key.

## What it does then

The rule's action runs and the epoch advances, so the same signature can never be replayed.

## Runs on

At 93,765 gas of validation (measured, inline form, salt ground by the signer) it fits the public mempool's 100,000 budget, and the alternative mempool.

## Code

```ts
// one EIP-712 digest for every scheme: chain, rule contract, rule, epoch, trigger data
const witness = signer.sign({ chainId, ruleContract, ruleId: 0n, ruleEpoch, triggerData });
const hash = await anyone.trigger(ruleContract, { triggerData, verifyData: witness }); // sent by a key with no ETH
```

## Limits

- One signature per leaf: the SDK records each leaf before it signs and refuses a second digest.
- Signatures are 2,496 bytes.
- Post-quantum signatures authenticate; they hide nothing from chain observers.
- Reviewed by us, not externally audited.
