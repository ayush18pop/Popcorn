---
name: "Post-Quantum Signer"
group: sign
trigger: people
status: built
runsOn: [public, alternative]
gas: null
example: examples/sign/sovereign-account/run.json
related: [signed-intent, hybrid-owner-key, multisig-signer]
postQuantum: true
schemes: [wots, fors, xmss, sphincs, falcon]
code: ["contracts/src/signers/WotsSigner.sol", "contracts/src/signers/ForsSigner.sol", "contracts/src/signers/XmssSigner.sol", "contracts/src/signers/SphincsSigner.sol", "contracts/src/signers/FalconSigner.sol", "packages/sdk/examples/09-pq-intent.ts"]
---

# Post-Quantum Signer

## What it does

A rule fires on a signature that a quantum computer cannot forge. Pick the scheme that fits how often the key signs:

| Scheme | Kind | Signs |
|---|---|---|
| WOTS+ | hash-based, one-time | once per leaf; the rule's epoch picks the leaf |
| FORS | hash-based, few-time | a small fixed number of times; the SDK refuses beyond it |
| XMSS-style | Merkle tree of one-time keys | many times under one public root |
| SPHINCS+-style | hash-based, stateless | any number of times (a keccak construction, not the NIST encoding) |
| Falcon-512 | lattice | any number of times (ZKNox's ETHFALCON verifier, vendored under MIT) |

## When it fires

When a signed intent for this rule contract, this rule and its current epoch verifies under the configured key.

## What it does then

The rule's action runs and the epoch advances, so the same signature can never be replayed.

## Runs on

WOTS+ with a ground salt fits the public mempool's budget. FORS, XMSS-style, SPHINCS+-style and Falcon run on the
alternative mempool, which admits validation of any size.

## Code

```ts
// WOTS+: the signer grinds the salt until verification needs at most maxSteps hash steps, and records each leaf it spends
const signer = wotsIntentSigner({ tree, firstEpoch: 0, binding: { chainId, ruleContract, ruleId: 0n }, store: fileUsageStore("leaves.json"), budget: { maxSteps: 380, maxTries: 3_000_000 } });
const witness = signer.sign({ chainId, ruleContract, ruleId: 0n, ruleEpoch: 0n, triggerData });
const hash = await anyone.trigger(ruleContract, { triggerData, verifyData: witness });
```

## Limits

- One-time and few-time keys never sign twice: the SDK records each digest before returning a signature.
- Post-quantum signatures authenticate; they hide nothing from chain observers.
- Reviewed by us, not externally audited.
