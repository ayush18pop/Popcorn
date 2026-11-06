---
name: "Exit To An Address"
shape: action
tier: 2
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "address", what: "committed once at setup (forced exit), or chosen at the time and signed by a committed key (migrate)" }
perTrigger: "nothing"
output: "everything sent, once; the build refuses everything after"
presets: ["Forced exit after a contested takeover (Walkaway Exit)", "Migrate with the post-quantum backup key (Quantum-Ready Treasury)"]
sdk: "exitTrigger"
related: [hand-over-to-a-new-key, switch-to-quantum-safe-only]
code: ["contracts/src/blocks/actions/ExitToAddress.sol"]
---

# Exit To An Address

## What it does

Sends everything the build holds to one address, once. A committed address cannot be changed later, so whoever takes control of the build cannot redirect the exit.

## Inputs

- **address**: committed once at setup (forced exit), or chosen at the time and signed by a committed key (migrate)
- **each trigger brings**: nothing
- **result**: everything sent, once; the build refuses everything after

## Presets

- Forced exit after a contested takeover (Walkaway Exit)
- Migrate with the post-quantum backup key (Quantum-Ready Treasury)

## Code

```ts
await anyone.trigger(account, exitTrigger());
```

```solidity
if (_contested()) _exit();                 // forced exit to the committed address
else if (_quantumSafeOnly()) _exitTo(signedTarget); // migrate
```

## Runs on

The block itself keeps plain storage and adds no mempool limit. The builds that use it today also check proofs or read other contracts, so they are staked on the alternative mempool.

## Limits

- A receiver that refuses ETH is credited and claims later; nothing is lost.
