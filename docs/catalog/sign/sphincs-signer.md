---
name: "SPHINCS+ Signer"
group: sign
trigger: people
priority: 3
status: built
runsOn: [alternative]
gas: { validation: 216764, tag: measured, network: local }
example: null
related: [quantum-switch, hybrid-owner-key, signed-intent]
postQuantum: true
code: ["contracts/src/signers/SphincsSigner.sol", "packages/sdk/src/sphincs.ts"]
---

# SPHINCS+ Signer

## What it does

Stateless hash-based signatures in the style of SPHINCS+ (SLH-DSA): sign any number of times with no state to track, and nothing a quantum computer can break.

## When it fires

When a signed intent for this rule contract, this rule and its current epoch verifies under the configured key.

## What it does then

The rule's action runs and the epoch advances, so the same signature can never be replayed.

## Runs on

At 216,764 gas of validation (measured) it runs on the alternative mempool, which admits validation of any size.

## Code

```ts
// one EIP-712 digest for every scheme: chain, rule contract, rule, epoch, trigger data
const witness = signer.sign({ chainId, ruleContract, ruleId: 0n, ruleEpoch, triggerData });
const hash = await anyone.trigger(ruleContract, { triggerData, verifyData: witness }); // sent by a key with no ETH
```

## Limits

- A keccak construction (n=16, h=20), not the NIST SLH-DSA encoding.
- The heaviest hash-based scheme here; stateless is what you pay for.
- Post-quantum signatures authenticate; they hide nothing from chain observers.
- Reviewed by us, not externally audited.
