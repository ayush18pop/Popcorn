// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ReentryRule contract
/// @notice Condition always true; nonceKey = uint256(keccak256(popArgs)).
///         popArgs[0] selects what __action does after counting itself (count += 1):
///           0x01: CALL address(this) with pop(hex"00")              (canonical SENDER calldata)
///           0x02: CALL address(this) with __action(hex"00", this)   (raw entry-point calldata)
///           else: nothing
///         The inner call, if Core runs __action again, counts once more (popArgs hex"00" = no re-entry).
///         Everything lives in one packed slot (one fresh slot): STATE_SLOT = result << 128 | count,
///         result = 0 not tried, 1 inner call succeeded, 2 inner call reverted.
/// @dev Runs only under DELEGATECALL from a rule contract (Core). A direct call reverts.
contract ReentryRule {
    bytes32 public constant STATE_SLOT = keccak256("popcorn.test.ReentryKernel.state");
    bytes4 public constant SEL_POP = 0xd9292504;

    address private immutable __self = address(this);

    error DirectCall();

    modifier onlyDelegated() {
        if (address(this) == __self) revert DirectCall();
        _;
    }

    function __nonceKey(bytes calldata popArgs) external view onlyDelegated returns (uint256) {
        return uint256(keccak256(popArgs));
    }

    function __condition(bytes calldata, bytes calldata) external view onlyDelegated returns (bool) {
        return true;
    }

    function __action(bytes calldata popArgs, address) external onlyDelegated {
        _store(_load() + 1);
        uint8 how = popArgs.length == 0 ? 0 : uint8(popArgs[0]);
        if (how != 1 && how != 2) return;
        bytes memory data = how == 1
            ? abi.encodeWithSelector(SEL_POP, bytes(hex"00"))
            : abi.encodeCall(this.__action, (bytes(hex"00"), address(this)));
        (bool ok,) = address(this).call(data);
        uint256 s = _load();
        _store((uint256(ok ? 1 : 2) << 128) | uint128(s));
    }

    function _load() private view returns (uint256 v) {
        bytes32 slot = STATE_SLOT;
        assembly {
            v := sload(slot)
        }
    }

    function _store(uint256 v) private {
        bytes32 slot = STATE_SLOT;
        assembly {
            sstore(slot, v)
        }
    }
}
