// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title GasProbeRule contract (measurement only: Core's VERIFY floor allowance)
/// @notice popArgs = abi.encode(uint256 want, uint256 salt) ++ any padding bytes (to vary the length).
///         __nonceKey: key = uint256(keccak256(popArgs)), then burns all but ~200 of its gas (worst case for Core).
///         __condition: true iff gasleft() at entry >= want (i.e. it received its whole conditionGas when
///         want = conditionGas - ENTRY_GAS), then burns all but ~200 of its gas.
///         __action: nothing.
/// @dev Uses GAS (gasleft) outside a CALL, which the mempool rules ban in VERIFY: this logic is for
///      ethrex_simulateFrameTransaction and Foundry only, never for a trigger meant to be included.
contract GasProbeRule {
    address private immutable __self = address(this);

    error DirectCall();

    modifier onlyDelegated() {
        if (address(this) == __self) revert DirectCall();
        _;
    }

    function __nonceKey(bytes calldata popArgs) external view onlyDelegated returns (uint256 key) {
        key = uint256(keccak256(popArgs));
        while (gasleft() > 200) {}
    }

    function __condition(bytes calldata popArgs, bytes calldata) external view returns (bool) {
        uint256 g = gasleft();
        if (address(this) == __self) revert DirectCall();
        uint256 want = uint256(bytes32(popArgs[0:32]));
        if (g < want) return false;
        while (gasleft() > 200) {}
        return true;
    }

    function __action(bytes calldata, address) external onlyDelegated {}
}
