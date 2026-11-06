---
name: "@popcorn/sdk"
corner: build
trigger: tooling
status: built
mempool: { public: true, alt: unstaked }
gas: null
example: examples/gas/rule-pays-counter/run.json
related: [simulator, core]
code: ["packages/sdk/src/popcorn.ts", "packages/sdk/README.md"]
---

# @popcorn/sdk

## What it does

A viem extension: deployRule, canTrigger, trigger, simulate, watch, and a signer for every scheme.

## When it fires

—

## What it does then

—

## Mempool

Off-chain.

## Code

```ts
const client = createPublicClient({ chain, transport: http() }).extend(popcorn({ devnet: "local" }));
const ready = await client.canTrigger(ruleContract); // READY or the Core code that blocks it
```

## Limits

- Not published to npm yet: use it from the repository.
