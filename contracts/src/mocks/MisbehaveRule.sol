// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MisbehaveRule contract
/// @notice popArgs[0] picks the behaviour (popArgs = abi.encodePacked(uint8 how, salt...)):
///   __nonceKey   how 1: reverts            how 2: returns 64 bytes     how 3: returns 0
///                else : uint256(keccak256(popArgs))
///   __condition  how 4: reverts            how 5: returns 64 bytes     how 6: returns the word 2
///                how 7: CALLs address(this) with pop(hex"00") while in VERIFY, and returns true
///                       only if that call reverted with exactly the 32-byte word 0x30
///                       (Core's "executing frame is not a SENDER frame" code), else false
///                else : true
///   __action     how 8: sends 1 wei to address(this) (the rule contract itself)
///                how 9: sends 1 wei to `payer` (== the rule contract in rule-pays)
///                then (8/9) records RESULT_SLOT = 1 if the transfer succeeded, 2 if it failed
///                else : nothing
/// @dev Runs only under DELEGATECALL from a rule contract (Core). A direct call reverts.
contract MisbehaveRule {
    bytes32 public constant RESULT_SLOT = keccak256("popcorn.test.MisbehaveKernel.result");
    bytes4 public constant SEL_POP = 0xd9292504;

    address private immutable __self = address(this);

    error DirectCall();
    error Nope();

    modifier onlyDelegated() {
        if (address(this) == __self) revert DirectCall();
        _;
    }

    function _how(bytes calldata popArgs) private pure returns (uint8) {
        return popArgs.length == 0 ? 0 : uint8(popArgs[0]);
    }

    function __nonceKey(bytes calldata popArgs) external view onlyDelegated returns (uint256) {
        uint8 how = _how(popArgs);
        if (how == 1) revert Nope();
        if (how == 2) {
            assembly {
                mstore(0, 1)
                mstore(32, 2)
                return(0, 64)
            }
        }
        if (how == 3) return 0;
        return uint256(keccak256(popArgs));
    }

    function __condition(bytes calldata popArgs, bytes calldata) external view onlyDelegated returns (bool) {
        uint8 how = _how(popArgs);
        if (how == 4) revert Nope();
        if (how == 5) {
            assembly {
                mstore(0, 1)
                mstore(32, 1)
                return(0, 64)
            }
        }
        if (how == 6) {
            assembly {
                mstore(0, 2)
                return(0, 32)
            }
        }
        if (how == 7) {
            (bool ok, bytes memory ret) = address(this).staticcall(abi.encodeWithSelector(SEL_POP, bytes(hex"00")));
            return !ok && ret.length == 32 && abi.decode(ret, (uint256)) == 0x30;
        }
        return true;
    }

    function __action(bytes calldata popArgs, address payer) external onlyDelegated {
        uint8 how = _how(popArgs);
        if (how != 8 && how != 9) return;
        (bool ok,) = (how == 8 ? address(this) : payer).call{value: 1}("");
        bytes32 slot = RESULT_SLOT;
        uint256 v = ok ? 1 : 2;
        assembly {
            sstore(slot, v)
        }
    }
}
