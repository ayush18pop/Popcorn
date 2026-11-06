---
name: "Repay A Loan"
shape: action
tier: 3
status: built
runsOn: [alternative-staked]
gas: null
inputs:
  - { name: "pool", what: "the lending pool (repayFor)" }
  - { name: "token", what: "the debt token the build holds as a reserve" }
  - { name: "borrower and amount", what: "whose loan, how much" }
perTrigger: "nothing"
output: "repaid, or why not (approve failed, repay refused)"
presets: ["Auto-Repay Loan: a quarter of the debt when health drops below 1.1"]
related: [value-crosses-a-line, payer-gets-rewarded]
code: ["contracts/src/blocks/actions/RepayLoan.sol"]
---

# Repay A Loan

## What it does

Repays part of a borrower's loan from a reserve the build holds. Best effort: on failure it clears the allowance and reports why, and never reverts.

## Inputs

- **pool**: the lending pool (repayFor)
- **token**: the debt token the build holds as a reserve
- **borrower and amount**: whose loan, how much
- **each trigger brings**: nothing
- **result**: repaid, or why not (approve failed, repay refused)

## Presets

- Auto-Repay Loan: a quarter of the debt when health drops below 1.1

## Code

```solidity
RepayFailure f = _repayLoan(address(pool), address(token), user, amount);
```

## Runs on

The block itself adds no mempool limit; Auto-Repay Loan reads the pool and the token, so it is staked on the alternative mempool.

## Limits

- The reserve must be in the build before the loan gets unhealthy.
