---
name: "Proof That The Rules Were Broken"
shape: check
tier: 2
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "verifier", what: "the circuit's verifier contract" }
  - { name: "rules", what: "how the target's live state becomes the proof's public inputs (the build supplies it)" }
perTrigger: "a claim: recipient and claim id (trigger data), and the proof (verify data)"
output: "yes / no / unknown"
presets: ["Demo Vault's rounding bug (circuits/exploit.circom)"]
sdk: "bountyClaim"
related: [pause-the-target, pay-the-reward, contract-pays-the-gas]
code: ["contracts/src/blocks/checks/RulesBrokenProof.sol"]
---

# Proof That The Rules Were Broken

## What it does

Yes when a zero-knowledge proof shows that the target's rules can be broken from its live state, without revealing how. The recipient and claim id are public inputs of the proof, so a copier who swaps in their own address gets nothing.

## Inputs

- **verifier**: the circuit's verifier contract
- **rules**: how the target's live state becomes the proof's public inputs (the build supplies it)
- **each trigger brings**: a claim: recipient and claim id (trigger data), and the proof (verify data)
- **answers**: yes / no / unknown

## Presets

- Demo Vault's rounding bug (circuits/exploit.circom)

## Code

```ts
const p = await proveExploit(state, exploit, BigInt(whitehat), 1n);
await anyone.trigger(bounty, bountyClaim(whitehat, 1n, p.proof)); // a key with no ETH
```

```solidity
function _rulesInputs(address recipient, uint256 claimId) internal view override returns (uint256[] memory) {
    return ExploitInputs.fromStorage(recipient, claimId); // the vault's live numbers, this build, the recipient
}
function condition(bytes calldata claim, bytes calldata proof) internal view override returns (bool) {
    return !_isPaused() && _rulesBroken(claim, proof).isYes();
}
```

## Runs on

A Groth16 check costs about 200k gas: a staked build on the alternative mempool.

## Limits

- Zero-knowledge, not post-quantum: the proof hides the exploit, but a quantum computer could forge one.
- The keys come from a development trusted setup; production needs a ceremony.
