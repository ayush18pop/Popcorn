---
name: "SPHINCS+ Signer"
shape: signer
tier: 3
status: built
runsOn: [alternative]
gas: { validation: 216764, tag: measured, network: local }
postQuantum: true
inputs:
  - { name: "public key", what: "the scheme's public key (a Merkle root, or a Falcon public key), in the Signature block's params" }
perTrigger: "the signature over the instruction digest (verify data)"
output: "YES when the signature verifies for this build, this instruction kind, its epoch and the exact trigger data"
useCases:
  ready: ["Measured on the local devnet by the SDK suite test/pq.network.test.ts"]
  configs: ["A post-quantum key for the Signature block", "One half of a hybrid key: ECDSA and this scheme must both sign"]
  ideas: []
sdk: "sphincsIntentSigner"
related: [signature, post-quantum-mode]
code: ["contracts/src/signers/SphincsSigner.sol", "packages/sdk/src/sphincs.ts"]
---

# SPHINCS+ Signer

## Overview

Stateless hash-based signatures in the style of SPHINCS+ (SLH-DSA): sign any number of times with no state to track, and nothing a quantum computer can break. It is a key type of the Signature block: anyone can deliver the signed instruction, and the build checks it.

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

At 216,764 gas of validation (measured) it runs on the alternative mempool, which admits validation of any size.

## Gotchas

- A keccak construction (n=16, h=20), not the NIST SLH-DSA encoding.
- The heaviest hash-based scheme here; stateless is what you pay for.
- Post-quantum signatures authenticate; they hide nothing from chain observers.
- Reviewed by us, not externally audited.
