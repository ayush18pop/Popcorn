// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";

/// @title Switch To Quantum-Safe Only (action block)
/// @notice A one-way switch. Before it flips, the owner's everyday key (ECDSA, or ECDSA plus another scheme) works as usual
///         and a post-quantum backup key is only committed, as a hash, never revealed. After it flips (the owner signs it,
///         or a group votes for it when the owner cannot), the build must refuse every everyday-key signature, and only
///         the backup key can act, for example once, through Exit To An Address, to move everything to a post-quantum home.
///
///         The block keeps the flag and the backup key's hash; the build reads `_quantumSafeOnly()` in its checks.
///         Committing the backup key as a hash matters: when ECDSA breaks, a key added at that moment could be added by
///         the attacker too, while a key committed long before cannot.
abstract contract QuantumSafeSwitch is RuleContract {
    /// @dev slot 0: switched flag; 1: backup key hash.
    bytes32 private constant SLOT = keccak256("popcorn.block.quantumSafeSwitch");

    event BackupKeyCommitted(bytes32 keyHash);
    event SwitchedToQuantumSafe(bool byGroup);

    error BackupKeyAlreadyCommitted();

    function _commitBackupKey(bytes32 keyHash) internal {
        if (_sload(bytes32(uint256(SLOT) + 1)) != 0) revert BackupKeyAlreadyCommitted();
        _sstore(bytes32(uint256(SLOT) + 1), uint256(keyHash));
        emit BackupKeyCommitted(keyHash);
    }

    function _backupKeyHash() internal view returns (bytes32) {
        return bytes32(_sload(bytes32(uint256(SLOT) + 1)));
    }

    function _quantumSafeOnly() internal view returns (bool) {
        return _sload(SLOT) == 1;
    }

    /// @notice Flips the switch. One way: there is no switch back.
    function _switchToQuantumSafe(bool byGroup) internal {
        _sstore(SLOT, 1);
        emit SwitchedToQuantumSafe(byGroup);
    }
}
