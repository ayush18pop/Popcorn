---
name: "Guarded Vault"
corner: pause
trigger: invariant
status: built
mempool: { public: true, alt: unstaked }
gas: null
example: examples/pause/guarded-vault/run.json
related: [proof-of-exploit-bounty, outflow-spike-pause, rule-pays]
code: ["contracts/src/templates/GuardedVault.sol", "contracts/docs/guarded-vault.md"]
---

# Guarded Vault

## What it does

A vault that pauses itself the moment its share price falls below its floor, from a trigger anyone can send.

## When it fires

When assets per share fall below the floor: `totalAssets * 1e18 < totalSupply * minAssetsPerShare`, read from the vault's own storage.

## What it does then

Sets `paused`, bumps the pause epoch and pays the reporter from the reward pool. Deposits, withdrawals and redemptions revert until the owner unpauses, and unpause requires the invariant to hold again.

## Mempool

The condition reads two words of the vault's own storage, which the public mempool accepts without stake.

## Code

```ts
// the pause trigger: anyone can send it, the vault pays
//   popArgs   = abi.encode(address reporter)
//   key       = keccak256(abi.encode("pause", address(this), pauseEpoch))
//   condition = !paused && T * 1e18 < S * M
const hash = await client.trigger(vault, { triggerData: encodeAbiParameters([{ type: "address" }], [reporter]) });
```

## Limits

- A drain inside one transaction or one block cannot be stopped; a multi-transaction drain can.
- Someone still has to notice and send the trigger. Anyone can, from a wallet with 0 ETH, and the reward pays them.
- The example vault contains a planted bug so the bounty profile has something to prove. Do not deploy it as is.
