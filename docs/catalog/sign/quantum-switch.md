---
name: "Quantum Switch"
group: sign
trigger: people
priority: 6
status: built
runsOn: [alternative-staked]
gas: { total: 488794, tag: measured, network: local }
example: examples/sign/quantum-ready-treasury/run.json
related: [wots-signer, hidden-guardians, hybrid-owner-key]
postQuantum: true
code: ["contracts/src/account/SovereignAccount.sol", "packages/sdk/src/account.ts"]
---

# Quantum Switch

## What it does

Prepares an account for the day ECDSA breaks. The account commits now to the hash of a post-quantum backup key that is never revealed until it is used. Once the switch flips, owner signatures stop working and only that backup key can move the funds, once.

## When it fires

The switch flips on the owner's signature or a quorum of hidden guardians. The migration fires on a WOTS+ signature, from the committed backup key, over the target address.

## What it does then

Refuses every owner spend from then on, and the migration sends every wei to the target the backup key signed.

## Runs on

The account stakes (its signature checks call signer contracts): the alternative mempool.

## Code

```ts
const backupParams = wotsParams(wotsIntentKey(backupTree, 0, chainId, ACCOUNT_RULE.MIGRATE)); // only its hash goes on chain
const w = signer.sign(accountBinding(chainId, account, ACCOUNT_RULE.MIGRATE, 0n, migrateData(target)));
await anyone.trigger(account, migrateTrigger(target, backupParams, w));
```

## Limits

- The backup key must be committed before an attacker can forge ECDSA; after that, adding one is too late for anybody.
- WOTS+ signs once, which is all a migration needs.
