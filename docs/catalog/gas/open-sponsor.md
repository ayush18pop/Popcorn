---
name: "Open Sponsor"
group: gas
trigger: payment
priority: 1
status: built
runsOn: [alternative-staked]
gas: { total: 390317, tag: measured, network: local }
example: examples/gas/open-gas-network/run.json
related: [caller-pays, membership-proof, rule-pays]
code: ["contracts/sponsor/OpenSponsor.yul", "packages/sdk/src/sponsor.ts", "packages/sdk/test/sponsor.network.test.ts"]
---

# Open Sponsor

## What it does

Pays other accounts' gas under a public, on-chain policy instead of a server that signs approvals: whoever meets the policy is sponsored, and nobody can be quietly dropped.

## When it fires

When a caller-pays transaction names the sponsor as its payer and ends with the sponsor's accounting frame, and the sender is covered: its own limit, every account (open), every account built on an allowed logic, or a member proven with a private membership proof.

## What it does then

Approves payment if the sender's budget for the period covers the worst-case cost and the fee is under the cap; the accounting frame then debits the budget and, for a membership admission, burns the member's nullifier so each member admits one account.

## Runs on

The policy reads the sponsor's own settings, which only a staked payer may do: the alternative mempool. Staking also covers a membership proof's gas.

## Code

```ts
const sponsor = (await deployOpenSponsor(clients, { owner, period: 3600n, maxFee: parseGwei("500"), defaultLimit: parseEther("3") })).address;
await stakeOpenSponsor(clients, sponsor, { amount: parseEther("0.1") });
await anyone.trigger(appAccount, sponsored(sponsor));                       // a covered account
await anyone.trigger(newAccount, sponsored(sponsor, { proof, nullifierHash })); // a member, once
```

## Limits

- Budgets are charged the worst-case cost, so a budget runs out a little early.
- Validation cannot read the clock: a period rolls over in the accounting frame or with roll(sender), which anyone may call.
