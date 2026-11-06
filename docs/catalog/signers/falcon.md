---
name: "Falcon-512 Signer"
shape: signer
tier: 2
status: built
runsOn: [alternative]
gas: { validation: 1500000, tag: estimated, network: local }
postQuantum: true
inputs:
  - { name: "public key", what: "the scheme's public key (a Merkle root, or a Falcon public key), in the Signature block's params" }
perTrigger: "the signature over the instruction digest (verify data)"
output: "YES when the signature verifies for this build, this instruction kind, its epoch and the exact trigger data"
useCases:
  ready: ["The flagship owner key, together with ECDSA (both keys must sign): Sovereign Account (recorded with ECDSA only until the Falcon signer is installed)"]
  configs: ["A post-quantum key for the Signature block", "One half of a hybrid key: ECDSA and this scheme must both sign"]
  ideas: []
sdk: "falconIntentSigner"
related: [signature, post-quantum-mode]
code: ["contracts/src/signers/FalconSigner.sol", "contracts/src/signers/vendor/ethfalcon", "packages/sdk/src/falcon.ts"]
---

# Falcon-512 Signer

## Overview

Lattice signatures (Falcon-512, NIST's FN-DSA family) through ZKNox's ETHFALCON verifier, vendored unchanged under MIT: compact post-quantum signatures, many-time and stateless. It is a key type of the Signature block: anyone can deliver the signed instruction, and the build checks it.

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

About 1.5 million gas of validation, so it runs on the alternative mempool, which admits validation of any size.

## Gotchas

- ETHFALCON hashes with keccak, not the NIST SHAKE256 encoding.
- Signing uses ZKNox's Python reference implementation; experimental upstream code.
- Post-quantum signatures authenticate; they hide nothing from chain observers.
- Reviewed by us, not externally audited.
