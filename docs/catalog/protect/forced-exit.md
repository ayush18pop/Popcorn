---
name: "Forced Exit"
group: protect
trigger: invariant
status: built
runsOn: [alternative-staked]
gas: null
example: examples/protect/walkaway-exit/run.json
related: [hidden-guardians, quantum-switch]
code: ["contracts/src/account/SovereignAccount.sol", "packages/sdk/src/account.ts"]
---

# Forced Exit

## What it does

If anyone takes control of an account against its owner, the money leaves to an address the owner committed to on day one. Contested control never ends with whoever won the vote holding the funds.

## When it fires

When the account is contested: a guardian takeover was pending and the current owner signed that it was not them.

## What it does then

Sends every wei to the committed exit address. Anyone may send the trigger, from a key with no ETH; the account pays.

## Runs on

The account stakes: the alternative mempool.

## Code

```ts
await contestRecovery(clients, account, ownerParams, ownerSignature); // the owner says no
await anyone.trigger(account, exitTrigger());                          // anyone moves the funds out
```

## Limits

- The exit address is fixed at creation; choose a cold address you control.
