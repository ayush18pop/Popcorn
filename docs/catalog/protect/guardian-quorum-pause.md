---
name: "Guardian Quorum Pause"
group: protect
trigger: people
status: planned
runsOn: [public, alternative]
gas: null
example: null
related: [multisig-signer, attested-facts]
code: []
---

# Guardian Quorum Pause

## What it does

Pause when k of n guardians sign, with no single pause key.

## When it fires

When a signed intent carries k valid guardian signatures for this rule's epoch.

## What it does then

Pauses the protocol.

## Runs on

ECDSA and WOTS+ guardian signatures with the quorum in the contract's own storage: the public mempool and the alternative mempool.

## Limits

- Larger post-quantum schemes need the local devnet's budget.
