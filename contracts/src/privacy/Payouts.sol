// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";

/// @title Payouts
/// @notice Sending ETH from an action that must never revert because of the receiver. The trigger's key is consumed
///         before the action runs (a spent nullifier, a used stealth commitment), so a receiver that refuses ETH must not
///         lose the funds: the transfer gets a fixed stipend and, if it fails, the amount is credited to the receiver,
///         who takes it later with claim(to).
abstract contract Payouts is RuleContract {
    /// @dev keccak256("popcorn.payouts"): owed(account) at keccak256(abi.encode(account, BASE)).
    bytes32 private constant OWED = 0xccfa1e39c9d869639c9fa1968358037038162176e9aa85f408d4d4d5b71e2ad7;
    uint256 public constant PAYOUT_GAS = 30_000;

    event Paid(address indexed to, uint256 amount);
    event Credited(address indexed to, uint256 amount, uint256 totalOwed);
    event Claimed(address indexed account, address to, uint256 amount);

    error NothingOwed();
    error ClaimFailed();

    function _owedSlot(address a) private pure returns (bytes32) {
        return keccak256(abi.encode(a, OWED));
    }

    function _sendOrCredit(address to, uint256 amount) internal {
        if (amount == 0) return;
        bool ok;
        uint256 g = PAYOUT_GAS;
        assembly ("memory-safe") {
            ok := call(g, to, amount, 0, 0, 0, 0)
        }
        if (ok) {
            emit Paid(to, amount);
        } else {
            uint256 total = _sload(_owedSlot(to)) + amount;
            _sstore(_owedSlot(to), total);
            emit Credited(to, amount, total);
        }
    }

    /// @notice What the contract owes `account` (a payout its receiver refused).
    function owed(address account) external view forwarded returns (uint256) {
        return _sload(_owedSlot(account));
    }

    /// @notice The caller takes what it is owed, sent to `to` with all gas.
    function claim(address to) external forwarded {
        uint256 a = _sload(_owedSlot(msg.sender));
        if (a == 0) revert NothingOwed();
        _sstore(_owedSlot(msg.sender), 0);
        (bool ok,) = to.call{value: a}("");
        if (!ok) revert ClaimFailed();
        emit Claimed(msg.sender, to, a);
    }
}
