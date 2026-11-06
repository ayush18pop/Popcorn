---
name: "Local Devnet"
corner: build
trigger: tooling
status: built
mempool: { public: true, alt: staked }
gas: null
example: null
related: [sdk]
code: ["devnet/README.md", "devnet/up.sh"]
---

# Local Devnet

## What it does

A local copy of the public devnet, on chain 1338, with 250,000 unstaked / 2,500,000 staked validation budgets.

## When it fires

`devnet/up.sh`

## What it does then

Deterministic contract addresses, the factory at the same address as the public devnet.

## Mempool

Runs both: ethrex at 250,000 and a sidecar with per-entity budgets.

## Code

```sh
devnet/up.sh                                   # about 10 minutes the first time
POPCORN_DEVNET=local bun packages/sdk/examples/01-rule-pays.ts
```

## Limits

- A second test target, not a replacement: the public devnet stays the reference.
