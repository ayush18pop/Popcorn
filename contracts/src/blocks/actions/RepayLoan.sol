// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";

interface IRepayable {
    function repayFor(address borrower, uint256 amount) external;
}

/// @title Repay A Loan (action block)
/// @notice Repays part of a borrower's loan on a lending pool from a reserve of the debt token that the build holds. Best
///         effort: approve the pool, call repayFor, and on failure clear the allowance and report why; never revert.
///         Pair it with Value Crosses A Line on the loan's health factor, and with Payer Gets Rewarded so whoever sends the
///         rescue earns a share: a loan that rescues itself, with no keeper.
abstract contract RepayLoan is RuleContract {
    /// @notice Why a repayment did not happen.
    enum RepayFailure {
        None,
        ApproveFailed,
        RepayFailed
    }

    event LoanRepaid(address indexed pool, address indexed borrower, uint256 amount);

    function _repayLoan(address pool, address token, address borrower, uint256 amount) internal returns (RepayFailure) {
        (bool a,) = token.call(abi.encodeWithSelector(0x095ea7b3, pool, amount)); // approve
        if (!a) return RepayFailure.ApproveFailed;
        (bool r,) = pool.call(abi.encodeCall(IRepayable.repayFor, (borrower, amount)));
        if (!r) {
            (bool z,) = token.call(abi.encodeWithSelector(0x095ea7b3, pool, 0));
            z; // best effort: clear the allowance
            return RepayFailure.RepayFailed;
        }
        emit LoanRepaid(pool, borrower, amount);
        return RepayFailure.None;
    }
}
