---
name: "Guardian Quorum Pause"
corner: pause
trigger: people
status: planned
mempool: { public: true, alt: unstaked }
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

## Mempool

Signature checks fit the public budget for ECDSA and WOTS+.

## Limits

- Larger post-quantum schemes need the local devnet's budget.
