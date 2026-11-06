---
name: "Pay The Reward"
shape: action
tier: 2
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "token", what: "ETH or one ERC-20" }
  - { name: "amount", what: "the reward per payout" }
  - { name: "who", what: "the recipient bound in a proof, or the gas payer; an address in the trigger data only for small rewards" }
perTrigger: "nothing"
output: "paid the smaller of the reward and the pool, or nothing"
presets: ["Bug bounty (with Proof That The Rules Were Broken)", "Small thank-you to whoever reported a broken state"]
related: [proof-that-the-rules-were-broken, payer-gets-rewarded]
code: ["contracts/src/blocks/actions/PayTheReward.sol"]
---

# Pay The Reward

## What it does

A public reward pool that anyone can fund, paid out by the build's action. It pays only someone a mempool copier cannot replace: the recipient bound in a proof, or whoever paid the gas.

## Inputs

- **token**: ETH or one ERC-20
- **amount**: the reward per payout
- **who**: the recipient bound in a proof, or the gas payer; an address in the trigger data only for small rewards
- **each trigger brings**: nothing
- **result**: paid the smaller of the reward and the pool, or nothing

## Presets

- Bug bounty (with Proof That The Rules Were Broken)
- Small thank-you to whoever reported a broken state

## Code

```ts
await wallet.writeContract({ address: bounty, abi, functionName: "fundRewards", args: [amount] });
```

```solidity
_pauseSelf();
_payFromPool(_claimRecipient(claim), BOUNTY_REWARD); // after the pause: payment is best effort
```

## Runs on

Actions run after validation, so they do not decide where a build runs.

## Limits

- A reward to an address in the trigger data can be copied by a mempool watcher: keep that kind small.
- An ETH pool shares the build's balance with the gas it pays: keep the balance above the pool plus the gas reserve. A token pool has no such limit.
