---
name: popcorn-debug
description: Explain why a Popcorn trigger (an EIP-8141 frame transaction to a rule contract) was refused or would be refused, which frame refused it, what it cost, and how to fix it. Use when canTrigger/simulate says not ready, a trigger is dropped or rejected by a mempool, or the user pastes a Core or sponsor error code.
---

# Debugging a Popcorn trigger

A refused trigger is refused by one frame. Find which, then explain in plain words.

## 1. Get the verdict

- With the `popcorn` MCP server: `can_trigger` (network, ruleContract, triggerData, verifyData, payer, payerData, tail).
  It simulates on the devnet's node and sends nothing. `rule_contract_info` shows the contract's mode, caps and balance.
- With the SDK: `client.canTrigger(ruleContract, options)` returns `{ ready, code, name, reason, canonical }`.

## 2. Read it

- `failedFrameIndex` 0, or a Core code (`0x01`-`0x4b`): the rule contract refused. Use `explain_code` with
  `frame: "rule"`. VERIFY codes mean the transaction is invalid and **nobody pays**. The most common:
  - `0x22` the condition is false right now (the rule is working as intended);
  - `0x1e`/`0x1f` or `NONCE_USED`: this event already fired (a spent nullifier, a used epoch);
  - `0x27` the VERIFY limit is below Core's floor: let the SDK derive `verifyGasLimit`.
- `PAYER_REFUSED` with a code `0x60`-`0x75`: the payer contract (an Open Sponsor) refused. Use `explain_code` with
  `frame: "payer"`: no tail frame, fee above the cap, budget spent, a reused or rejected membership proof.
- `ACTION_REVERTS`: validation passes but the action reverts. The payer would pay for nothing; do not send it.
- Mempool rejections from the sidecar:
  - `exceeds unstaked budget`: stake the contract (`stakeRule`, or `stakeOpenSponsor`), or run the local sidecar with
    the public devnet's budgets (decision 73);
  - `unstaked payer accessed payer slot`: a payer reading its own global settings must be staked;
  - `canonical: false` only means the node's own mempool would refuse it; the alternative mempool can still admit it.
- "relayed N times without being included": the local relay gave up. If `can_trigger` still says ready, send it again.

## 3. Answer

State the frame, the code, the plain reason, who paid (usually nobody), and the one change that fixes it. If the
condition is simply false, say what state would make it true.
