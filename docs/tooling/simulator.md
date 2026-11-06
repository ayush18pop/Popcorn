---
name: "Simulator"
corner: build
trigger: tooling
status: built
mempool: { public: true, alt: unstaked }
gas: null
example: null
related: [sdk]
code: ["packages/simulator/src/rules.ts", "packages/sdk/bin/popcorn-simulate.ts"]
---

# Simulator

## What it does

Which mempool will accept a transaction, which rule blocks it, and the fix, in plain English.

## When it fires

When you call `simulate()` or run the CLI.

## What it does then

Prints each mempool's verdict. Sends nothing unless you opt in.

## Mempool

Off-chain.

## Code

```sh
bun packages/sdk/bin/popcorn-simulate.ts <rule contract> --devnet local
```

## Limits

- The alternative mempool's verdict is predicted unless you ask the sidecar, which may also include the transaction.
