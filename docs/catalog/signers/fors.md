---
name: "FORS Signer"
shape: signer
tier: 3
status: built
runsOn: [public, alternative]
gas: { validation: 90176, tag: measured, network: local }
postQuantum: true
inputs:
  - { name: "public key", what: "the scheme's public key (a Merkle root, or a Falcon public key), in the Signature block's params" }
perTrigger: "the signature over the instruction digest (verify data)"
output: "YES when the signature verifies for this build, this instruction kind, its epoch and the exact trigger data"
useCases:
  ready: ["Measured on the local devnet by the SDK suite test/pq.network.test.ts"]
  configs: ["A post-quantum key for the Signature block", "One half of a hybrid key: ECDSA and this scheme must both sign"]
  ideas: []
sdk: "forsIntentSigner"
related: [signature, post-quantum-mode]
code: ["contracts/src/signers/ForsSigner.sol", "contracts/src/conditions/ForsIntentCondition.sol", "packages/sdk/src/fors.ts"]
---

# FORS Signer

## Overview

Forest of Random Subsets: a few-time hash-based signature (the building block inside SPHINCS+). A key may sign a small, fixed number of times; the SDK refuses beyond that budget. It is a key type of the Signature block: anyone can deliver the signed instruction, and the build checks it.

## Configuration

- **public key**: the scheme's public key, in the Signature block's params
- **trigger payload**: the signature over the instruction digest (verify data)
- **returns**: YES when the signature verifies for this build, this instruction kind, its epoch and the exact trigger data

## Usage

```ts
// one EIP-712 digest for every scheme: chain, rule contract, rule, epoch, trigger data
const witness = signer.sign({ chainId, ruleContract, ruleId: 0n, ruleEpoch, triggerData });
const hash = await anyone.trigger(ruleContract, { triggerData, verifyData: witness }); // sent by a key with no ETH
```

## Mempool

At 90,176 gas of validation (measured, inline form) it fits the public mempool's budget, and the alternative mempool.

## Gotchas

- Few-time: security drops with each signature, so the SDK enforces the budget.
- Larger signatures than WOTS+.
- Post-quantum signatures authenticate; they hide nothing from chain observers.
- Reviewed by us, not externally audited.
