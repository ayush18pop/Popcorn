// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title RecorderRule contract
/// @notice Condition always true. nonceKey = keccak256(abi.encode(popArgs, epoch)), so any popArgs
///         (including empty) triggers once per epoch. __action records what it was given:
///           EPOCH_SLOT  += 1
///           HASH_SLOT    = keccak256(popArgs)
///           META_SLOT    = popArgs.length << 160 | payer
///         Three fresh slots on the first trigger (3 x 97,920 state gas), none after.
/// @dev Runs only under DELEGATECALL from a rule contract (Core). A direct call reverts.
contract RecorderRule {
    bytes32 public constant EPOCH_SLOT = keccak256("popcorn.test.RecorderKernel.epoch");
    bytes32 public constant HASH_SLOT = keccak256("popcorn.test.RecorderKernel.hash");
    bytes32 public constant META_SLOT = keccak256("popcorn.test.RecorderKernel.meta");

    address private immutable __self = address(this);

    error DirectCall();

    modifier onlyDelegated() {
        if (address(this) == __self) revert DirectCall();
        _;
    }

    function __nonceKey(bytes calldata popArgs) external view onlyDelegated returns (uint256) {
        return uint256(keccak256(abi.encode(popArgs, _load(EPOCH_SLOT))));
    }

    function __condition(bytes calldata, bytes calldata) external view onlyDelegated returns (bool) {
        return true;
    }

    function __action(bytes calldata popArgs, address payer) external onlyDelegated {
        _store(EPOCH_SLOT, _load(EPOCH_SLOT) + 1);
        _store(HASH_SLOT, uint256(keccak256(popArgs)));
        _store(META_SLOT, (popArgs.length << 160) | uint256(uint160(payer)));
    }

    function _load(bytes32 slot) private view returns (uint256 v) {
        assembly {
            v := sload(slot)
        }
    }

    function _store(bytes32 slot, uint256 v) private {
        assembly {
            sstore(slot, v)
        }
    }
}
