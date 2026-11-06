---
name: "XMSS Signer"
shape: signer
tier: 3
status: built
runsOn: [public, alternative]
gas: { validation: 94076, tag: measured, network: local }
postQuantum: true
inputs:
  - { name: "public key", what: "the scheme's public key (a Merkle root, or a Falcon public key), in the Signature block's params" }
perTrigger: "the signature over the instruction digest (verify data)"
output: "YES when the signature verifies for this build, this instruction kind, its epoch and the exact trigger data"
useCases:
  ready: ["Measured on the local devnet by the SDK suite test/pq.network.test.ts"]
  configs: ["A post-quantum key for the Signature block", "One half of a hybrid key: ECDSA and this scheme must both sign"]
  ideas: []
sdk: "xmssIntentSigner"
related: [signature, post-quantum-mode]
code: ["contracts/src/signers/XmssSigner.sol", "contracts/src/conditions/XmssIntentCondition.sol", "packages/sdk/src/xmss.ts"]
---

# XMSS Signer

## Overview

A Merkle tree of WOTS+ one-time keys (height 10): many post-quantum signatures under one public root, each from a fresh leaf, in the style of XMSS (RFC 8391). It is a key type of the Signature block: anyone can deliver the signed instruction, and the build checks it.

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

At 94,076 gas of validation (measured, inline form) it fits the public mempool's budget, and the alternative mempool.

## Gotchas

- Stateful: the signer must never reuse a leaf; the SDK records each one before signing.
- A keccak construction in XMSS style, not the RFC's exact encoding.
- Post-quantum signatures authenticate; they hide nothing from chain observers.
- Reviewed by us, not externally audited.
