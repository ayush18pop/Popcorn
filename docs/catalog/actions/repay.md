---
name: "Repay"
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
useCases:
  ready: ["A quarter of the debt when health drops below 1.1: Auto-Repay Loan (tested build)"]
  configs: []
  ideas: []
related: [compare, caller-pays]
code: ["contracts/src/blocks/actions/RepayLoan.sol"]
---

# Repay

## Overview

Repays part of a borrower's loan from a reserve the build holds. Best effort: on failure it clears the allowance and reports why, and never reverts.

## Configuration

- **pool**: the lending pool (repayFor)
- **token**: the debt token the build holds as a reserve
- **borrower and amount**: whose loan, how much
- **trigger payload**: nothing
- **effect**: repaid, or why not (approve failed, repay refused)

## Use cases

### Ready to use

- A quarter of the debt when health drops below 1.1: Auto-Repay Loan (tested build)

## Usage

```solidity
RepayFailure f = _repayLoan(address(pool), address(token), user, amount);
```

## Mempool

The block itself adds no mempool limit; Auto-Repay Loan reads the pool and the token, so it is staked on the alternative mempool.

## Gotchas

- The reserve must be in the build before the loan gets unhealthy.
