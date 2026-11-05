// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title VerifyDataRule contract
/// @notice Proves Core hands the logic the right bytes (frame 0 data as verifyData, SENDER popArgs).
///         __condition is true only if
///           (a) popArgs is exactly EXPECTED_POP_ARGS and verifyData is exactly EXPECTED_VERIFY_DATA
///               (300 bytes, byte i = uint8(i * 31 + 7)), or
///           (b) popArgs = abi.encode(bytes32 h, uint256 n, uint256 salt) (96 bytes) and
///               verifyData.length == n and keccak256(verifyData) == h (any length, e.g. 0/31/32/33).
///         nonceKey = keccak256(abi.encode(popArgs, epoch)); __action increments epoch, so the same
///         popArgs can trigger once per epoch (the suite is re-runnable on one rule contract).
/// @dev Runs only under DELEGATECALL from a rule contract (Core). A direct call reverts.
contract VerifyDataRule {
    bytes public constant EXPECTED_VERIFY_DATA = hex"0726456483a2c1e0ff1e3d5c7b9ab9d8f71635547392b1d0ef0e2d4c6b8aa9c8e70625446382a1c0dffe1d3c5b7a99b8d7f61534537291b0cfee0d2c4b6a89a8c7e60524436281a0bfdefd1c3b5a7998b7d6f51433527190afceed0c2b4a6988a7c6e504234261809fbeddfc1b3a597897b6d5f4133251708faecdec0b2a496887a6c5e4032241607f9ebddcfb1a39587796b5d4f31231506f8eadcceb0a29486786a5c4e30221405f7e9dbcdbfa1938577695b4d3f211304f6e8daccbea0928476685a4c3e201203f5e7d9cbbdaf91837567594b3d2f1102f4e6d8cabcae90827466584a3c2e1001f3e5d7c9bbad9f81736557493b2d1f00f2e4d6c8baac9e80726456483a2c1e0ff1e3d5c7b9ab9d8f71635547392b1d0ef0e2d4c6b8aa9c8e70625446382a1c0dffe1d3c";
    bytes public constant EXPECTED_POP_ARGS = "popcorn.test.VerifyDataKernel.popArgs";
    bytes32 public constant EPOCH_SLOT = keccak256("popcorn.test.VerifyDataKernel.epoch");

    address private immutable __self = address(this);

    error DirectCall();

    modifier onlyDelegated() {
        if (address(this) == __self) revert DirectCall();
        _;
    }

    function __nonceKey(bytes calldata popArgs) external view onlyDelegated returns (uint256) {
        return uint256(keccak256(abi.encode(popArgs, _epoch())));
    }

    function __condition(bytes calldata popArgs, bytes calldata verifyData) external view onlyDelegated returns (bool) {
        if (keccak256(popArgs) == keccak256(EXPECTED_POP_ARGS)) {
            return verifyData.length == 300 && keccak256(verifyData) == keccak256(EXPECTED_VERIFY_DATA);
        }
        if (popArgs.length != 96) return false;
        (bytes32 h, uint256 n,) = abi.decode(popArgs, (bytes32, uint256, uint256));
        return verifyData.length == n && keccak256(verifyData) == h;
    }

    function __action(bytes calldata, address) external onlyDelegated {
        bytes32 slot = EPOCH_SLOT;
        assembly {
            sstore(slot, add(sload(slot), 1))
        }
    }

    function _epoch() private view returns (uint256 e) {
        bytes32 slot = EPOCH_SLOT;
        assembly {
            e := sload(slot)
        }
    }
}
