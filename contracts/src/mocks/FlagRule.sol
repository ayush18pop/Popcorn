// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title FlagRule contract (test logic for Popcorn Core)
/// @notice popArgs = abi.encode(uint256 cmd, uint256 salt).
///   cmd FIRE (0):    condition = flag is on;  action increments a counter.
///   cmd SET_ON (1):  condition = true;        action sets the flag.
///   cmd SET_OFF (2): condition = true;        action clears the flag.
///   any other cmd:   condition = false.
/// nonceKey = uint256(keccak256(popArgs)), so each (cmd, salt) triggers once; tests vary the salt.
/// @dev Why the flag is set by a trigger: Core rejects every non-frame call (only empty-calldata ETH
///      transfers succeed), has no admin path and no initializer, so the rule contract's storage can only be
///      written by its own SENDER frame, i.e. by __action. SET_ON/SET_OFF are therefore triggers whose
///      condition is always true. This is a TEST fixture: anyone can trigger SET_ON. A real rule contract would
///      gate such a command on something (an owner signature, a proof).
///      Runs only under DELEGATECALL from a rule contract (Core). A direct call reverts.
contract FlagRule {
    uint256 public constant FIRE = 0;
    uint256 public constant SET_ON = 1;
    uint256 public constant SET_OFF = 2;

    bytes32 public constant FLAG_SLOT = keccak256("popcorn.test.FlagKernel.flag");
    bytes32 public constant COUNTER_SLOT = keccak256("popcorn.test.FlagKernel.counter");

    address private immutable __self = address(this);

    error DirectCall();

    modifier onlyDelegated() {
        if (address(this) == __self) revert DirectCall();
        _;
    }

    function __nonceKey(bytes calldata popArgs) external view onlyDelegated returns (uint256) {
        return uint256(keccak256(popArgs));
    }

    function __condition(bytes calldata popArgs, bytes calldata) external view onlyDelegated returns (bool) {
        (uint256 cmd,) = abi.decode(popArgs, (uint256, uint256));
        if (cmd == FIRE) return _load(FLAG_SLOT) != 0;
        return cmd == SET_ON || cmd == SET_OFF;
    }

    function __action(bytes calldata popArgs, address) external onlyDelegated {
        (uint256 cmd,) = abi.decode(popArgs, (uint256, uint256));
        if (cmd == FIRE) _store(COUNTER_SLOT, _load(COUNTER_SLOT) + 1);
        else if (cmd == SET_ON) _store(FLAG_SLOT, 1);
        else if (cmd == SET_OFF) _store(FLAG_SLOT, 0);
        else revert();
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
