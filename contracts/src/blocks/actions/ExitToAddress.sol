// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Payouts} from "src/privacy/Payouts.sol";

/// @title Exit To An Address (action block)
/// @notice Sends everything the build holds (its whole ETH balance) to one address, once. After an exit the block reports
///         `exited`, and a build should refuse every other trigger: the money has left.
///
///         Two presets:
///           - forced exit: the address is committed when the build is set up (`_commitExitAddress`) and `_exit()` sends
///             there. Nobody can change it later, so whoever takes control of the build cannot redirect the exit.
///           - migrate: `_exitTo(to)` sends to an address chosen at the time, e.g. one signed by a committed backup key.
///
///         A receiver that refuses ETH does not lose it: the amount is credited and claimable (Payouts).
abstract contract ExitToAddress is Payouts {
    /// @dev slot 0: exit address; slot 1: exited flag.
    bytes32 private constant SLOT = keccak256("popcorn.block.exitToAddress");

    event ExitAddressCommitted(address indexed to);
    event Exited(address indexed to, uint256 amount);

    error ExitAddressAlreadyCommitted();
    error ZeroExitAddress();

    function _commitExitAddress(address to) internal {
        if (to == address(0)) revert ZeroExitAddress();
        if (_sload(SLOT) != 0) revert ExitAddressAlreadyCommitted();
        _sstore(SLOT, uint256(uint160(to)));
        emit ExitAddressCommitted(to);
    }

    function _exitAddress() internal view returns (address) {
        return address(uint160(_sload(SLOT)));
    }

    function _exited() internal view returns (bool) {
        return _sload(bytes32(uint256(SLOT) + 1)) == 1;
    }

    /// @notice Forced exit: everything to the committed address.
    function _exit() internal returns (uint256) {
        return _exitTo(_exitAddress());
    }

    /// @notice Everything to `to`, once. Marks the build as exited before sending.
    function _exitTo(address to) internal returns (uint256 amount) {
        _sstore(bytes32(uint256(SLOT) + 1), 1);
        amount = address(this).balance;
        emit Exited(to, amount);
        _sendOrCredit(to, amount);
    }
}
