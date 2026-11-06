---
name: "Pool Pays"
group: gas
trigger: payment
priority: 3
status: built
runsOn: [alternative-staked]
gas: null
example: examples/private/private-payroll/run.json
related: [private-pool, stealth-address, rule-pays]
code: ["contracts/src/privacy/PrivatePool.sol", "contracts/src/privacy/StealthVault.sol", "packages/sdk/src/privacy.ts"]
---

# Pool Pays

## What it does

A contract that releases value pays for the release out of the value itself, so the person receiving it never needs ETH, a relayer or a sponsor.

## When it fires

Whenever the releasing contract's own condition is true: a valid withdrawal or spend proof whose fee is at least the contract's minimum.

## What it does then

The contract approves execution and payment in one step and keeps the fee. The minimum fee is the most one release can cost at the contract's fee caps, computed when it is deployed.

## Runs on

The same mempool as the contract that pays: the alternative mempool, staked, for the private pool and the stealth vault.

## Code

```ts
const { caps, minFee } = privatePoolCaps({ maxFeePerGas: parseGwei("10"), maxPriorityFeePerGas: parseGwei("2") });
// minFee = maxCostPerTrigger(caps): every withdrawal must carry at least this, bound into its proof
```

## Limits

- The fee is fixed at the worst case, so a release in a quiet block overpays a little; the surplus stays in the contract.
