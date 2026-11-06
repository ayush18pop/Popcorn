---
name: "Falcon-512 Signer"
group: sign
trigger: people
priority: 5
status: built
runsOn: [alternative]
gas: { validation: 1500000, tag: estimated, network: local }
example: null
related: [quantum-switch, hybrid-owner-key, signed-intent]
postQuantum: true
code: ["contracts/src/signers/FalconSigner.sol", "contracts/src/signers/vendor/ethfalcon", "packages/sdk/src/falcon.ts"]
---

# Falcon-512 Signer

## What it does

Lattice signatures (Falcon-512, NIST's FN-DSA family) through ZKNox's ETHFALCON verifier, vendored unchanged under MIT: compact post-quantum signatures, many-time and stateless.

## When it fires

When a signed intent for this rule contract, this rule and its current epoch verifies under the configured key.

## What it does then

The rule's action runs and the epoch advances, so the same signature can never be replayed.

## Runs on

About 1.5 million gas of validation, so it runs on the alternative mempool, which admits validation of any size.

## Code

```ts
// one EIP-712 digest for every scheme: chain, rule contract, rule, epoch, trigger data
const witness = signer.sign({ chainId, ruleContract, ruleId: 0n, ruleEpoch, triggerData });
const hash = await anyone.trigger(ruleContract, { triggerData, verifyData: witness }); // sent by a key with no ETH
```

## Limits

- ETHFALCON hashes with keccak, not the NIST SHAKE256 encoding.
- Signing uses ZKNox's Python reference implementation; experimental upstream code.
- Post-quantum signatures authenticate; they hide nothing from chain observers.
- Reviewed by us, not externally audited.
