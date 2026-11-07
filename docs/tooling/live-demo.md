# Live exploit demo

This demo uses a deliberately buggy vault and a small rule-set build on the public frame-transaction devnet (chain 1337). It deploys no ZK bounty contract and changes no Core code.

## Prepare

Run from the repository root. Use a throwaway devnet key in the existing key-file format, funded with at least 0.08 devnet ETH. Do not run another process with the same key while the demo runs.

```sh
forge build --root contracts
POPCORN_DEVNET=devnet1 bun packages/sdk/scripts/demo-simple-exploit.ts
```

The default key file is `keys/deployer.json`; override it with `POPCORN_KEY=/absolute/path/to/key.json`. The script writes public evidence to `examples/incidents/simple-exploit-devnet1.json` after each step, marking the incident complete only when every assertion passes. Private keys are never written to this record.

## Present

The story is a sequence of separate transactions:

1. Depositors and an attacker deposit into the demo vault.
2. A trigger while healthy is refused by the alternative mempool. It never reaches the chain and costs no gas.
3. Yield exposes the planted rounding bug. The attacker's withdrawal lowers assets without burning shares.
4. A stranger with zero ETH submits a frame transaction. VERIFY approves the condition and payment; SENDER calls the action. The build pays and pauses the vault.
5. A second attacker withdrawal reverts on chain. Unlike a validation refusal, this ordinary reverted transaction costs gas.
6. Another trigger is refused. Every attempt has a distinct transaction hash.

The script fails on an unexpected outcome, a duplicate hash, an admission instead of a refusal, a transport failure presented as a refusal, or a trigger that does not pause the vault. It requires both simulation's CONDITION_FALSE and the sidecar's recorded Core 0x22 refusal. It prints PASS only after all checks succeed.

## Evidence and limits

Included and reverted transactions are verified through chain receipts. Refusals are evidence from the sidecar, saved immediately because its records are held in memory and disappear on restart. Refused transactions have no block or chain receipt.

Saved state readings and pre-submit flows identify the block where they were evaluated. They are recorded observations, not historical values reconstructed from a later node state. The included trigger's flow is derived separately from inclusion. Optional getter values never change validation results.

Popcorn pauses between transactions. It does not undo or interrupt the attacker's first transaction. This demo shows a successful first withdrawal followed by a blocked retry.

Open `http://localhost:5173/#/explorer/incident/simple-exploit-devnet1` for the complete incident timeline, including deployment, configuration, staking, funding and every recorded attempt. Every hash opens a transaction page with its role, recorded membership, conditions where available and previous/next recorded steps. The same index covers all six recorded example projects. Full flows and raw evidence remain under Details. The “Verify on chain” button rechecks included and reverted receipts without sending transactions. Refusals are labelled as saved sidecar evidence.

The existing explorer can inspect each hash separately; the verification script rechecks the recorded chain receipts:

```sh
bun packages/sdk/scripts/verify-incident.ts
```

When the site imports a record at build time, rebuild after recording. An already deployed site will also need a new build to contain the new record.
