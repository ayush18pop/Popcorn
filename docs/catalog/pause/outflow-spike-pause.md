---
name: "Outflow Spike Pause"
corner: pause
trigger: invariant
status: planned
mempool: { public: true, alt: unstaked }
gas: null
example: null
related: [guarded-vault, share-price-floor-pause]
code: []
---

# Outflow Spike Pause

## What it does

Pause when more leaves the protocol in one window than it allows.

## When it fires

When tracked outflow over the current window exceeds the configured limit.

## What it does then

Pauses withdrawals and pays the reporter.

## Mempool

Planned to read only the protocol's own outflow counters.

## Limits

- Validation has no clock, so the window must be advanced by the protocol's own actions, not by time.
