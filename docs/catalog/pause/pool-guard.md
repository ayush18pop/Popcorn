---
name: "Pool Guard"
corner: pause
trigger: dependency
status: built
mempool: { public: false, alt: staked }
gas: null
example: null
related: [rule-sets, threshold-condition]
code: ["contracts/src/examples/PoolGuard.sol", "contracts/src/rules/RuleSet.sol"]
---

# Pool Guard

## What it does

Two ordered rules over a pool you depend on: one fires when the pool is paused, the other when its value falls below a floor.

## When it fires

Rule 0 when `pool.paused()` is true; otherwise rule 1 when `pool.value()` is below `floor`.

## What it does then

Records which rule fired. Replace the action with your own pause, exit or repay call.

## Mempool

Both rules read another contract (`pool.paused()`, `pool.value()`), which needs a staked rule contract on the alternative mempool.

## Code

```ts
// a rule set written in Solidity, with a Solidity action
// rule 0: pool.paused() == true
// rule 1 (else): pool.value() < floor
function _runAction(uint256 ruleId, bytes calldata) internal override {
    _recordFired(ruleId);
}
```

## Limits

- Reads another contract, so the public EIP-8141 mempool refuses it whatever the stake.
- The action writes a fresh slot the first time: deploy with `maxStateGasPerFrame >= 2 * 97,920` (the SDK default).
