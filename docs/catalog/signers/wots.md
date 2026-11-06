---
name: "WOTS+ Signer"
shape: signer
tier: 2
status: built
runsOn: [public, alternative]
gas: { validation: 93765, tag: measured, network: local }
postQuantum: true
inputs:
  - { name: "public key", what: "the scheme's public key (a Merkle root, or a Falcon public key), in the Signature block's params" }
perTrigger: "the signature over the instruction digest (verify data)"
output: "YES when the signature verifies for this build, this instruction kind, its epoch and the exact trigger data"
useCases:
  ready: ["The committed backup key that migrates the treasury: Quantum-Ready Treasury, Sovereign Account", "SDK example 09-pq-intent, measured on the local devnet by test/pq.network.test.ts"]
  configs: ["A post-quantum key for the Signature block", "One half of a hybrid key: ECDSA and this scheme must both sign"]
  ideas: []
sdk: "wotsIntentSigner"
related: [signature, post-quantum-mode]
code: ["contracts/src/signers/WotsSigner.sol", "contracts/src/conditions/WotsIntentCondition.sol", "packages/sdk/src/wots.ts", "packages/sdk/examples/09-pq-intent.ts"]
---

# WOTS+ Signer

## Overview

Winternitz one-time signatures over keccak: a quantum computer cannot forge them. A Merkle tree of 1,024 one-time keys sits under one public root, and the rule's epoch picks the leaf, so each key signs exactly once by construction. Core's own owner key is ECDSA plus WOTS+. It is a key type of the Signature block: anyone can deliver the signed instruction, and the build checks it.

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

At 93,765 gas of validation (measured, inline form, salt ground by the signer) it fits the public mempool's 100,000 budget, and the alternative mempool.

## Gotchas

- One signature per leaf: the SDK records each leaf before it signs and refuses a second digest.
- Signatures are 2,496 bytes.
- Post-quantum signatures authenticate; they hide nothing from chain observers.
- Reviewed by us, not externally audited.
