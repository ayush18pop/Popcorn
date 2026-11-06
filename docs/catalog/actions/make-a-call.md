---
name: "Make A Call"
shape: action
tier: 1
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "target", what: "any contract" }
  - { name: "data and value", what: "what to call, with how much ETH" }
  - { name: "gas cap", what: "the most the call may use" }
perTrigger: "nothing (or the call itself, in a signed instruction)"
output: "the call happened, or a failure is reported"
presets: ["A wallet spend (with Signed Instruction)", "Swap out of a depegged asset", "Withdraw from a protocol that was just upgraded"]
sdk: "blocks.makeACall"
related: [signed-instruction, pause-the-target]
code: ["contracts/src/blocks/actions/MakeACall.sol"]
---

# Make A Call

## What it does

Calls any contract from the build. Best effort: a failed call is reported in an event and the action carries on, because the trigger's key is already spent.

## Inputs

- **target**: any contract
- **data and value**: what to call, with how much ETH
- **gas cap**: the most the call may use
- **each trigger brings**: nothing (or the call itself, in a signed instruction)
- **result**: the call happened, or a failure is reported

## Presets

- A wallet spend (with Signed Instruction)
- Swap out of a depegged asset
- Withdraw from a protocol that was just upgraded

## Code

```ts
blocks.makeACall(vault, { data: encodeFunctionData({ abi, functionName: "withdrawAll" }), gas: 200_000 })
```

```solidity
_makeCall(to, value, data, 200_000);
```

## Runs on

Actions run after validation, so they do not decide where a build runs.

## Limits

- The build pays for a failed call too: cap the gas when the callee is not trusted.
