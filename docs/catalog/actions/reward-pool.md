---
name: "Reward Pool"
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
useCases:
  ready: ["Bug bounty: Proof-of-Exploit Bounty"]
  configs: ["A small reward to whoever reports a broken state"]
  ideas: []
related: [exploit-proof, caller-pays]
code: ["contracts/src/blocks/actions/PayTheReward.sol"]
---

# Reward Pool

## Overview

A public reward pool that anyone can fund, paid out by the build's action. It pays only someone a mempool copier cannot replace: the recipient bound in a proof, or whoever paid the gas.

## Configuration

- **token**: ETH or one ERC-20
- **amount**: the reward per payout
- **who**: the recipient bound in a proof, or the gas payer; an address in the trigger data only for small rewards
- **trigger payload**: nothing
- **effect**: paid the smaller of the reward and the pool, or nothing

## Use cases

### Ready to use

- Bug bounty: Proof-of-Exploit Bounty

### Common configurations

- A small reward to whoever reports a broken state

## Usage

```ts
await wallet.writeContract({ address: bounty, abi, functionName: "fundRewards", args: [amount] });
```

```solidity
_pauseSelf();
_payReward(_claimRecipient(claim), BOUNTY_REWARD); // after the pause: payment is best effort
```

## Mempool

Actions run after validation, so they do not decide where a build runs.

## Gotchas

- A reward to an address in the trigger data can be copied by a mempool watcher: keep that kind small.
