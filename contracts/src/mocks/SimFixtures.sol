// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";

/// @title simulate() fixtures: one logic per failure the simulator explains. Test use only.
/// @dev Each runs only under DELEGATECALL from a rule contract (Core). nonceKey = keccak256(popArgs), action = nothing.
abstract contract SimBase {
    address internal immutable __self = address(this);

    error DirectCall();

    modifier onlyDelegated() {
        if (address(this) == __self) revert DirectCall();
        _;
    }

    function __nonceKey(bytes calldata popArgs) external view onlyDelegated returns (uint256) {
        return uint256(keccak256(popArgs));
    }

    function __action(bytes calldata, address) external onlyDelegated {}
}

interface IValue {
    function value() external view returns (uint256);
}

/// @notice Condition reads ANOTHER contract's storage (`target.value() > 0`): needs a stake in the alt mempool, and
///         public ethrex rejects it (StorageReadNonSender).
contract SimReadOtherRule is SimBase {
    address public immutable target;

    constructor(address t) {
        target = t;
    }

    function __condition(bytes calldata, bytes calldata) external view onlyDelegated returns (bool) {
        (bool ok, bytes memory r) = target.staticcall{gas: 20_000}(abi.encodeCall(IValue.value, ()));
        return ok && r.length == 32 && abi.decode(r, (uint256)) > 0;
    }
}

/// @notice Condition burns about `rounds * ~120` gas of pure computation (no GAS opcode), then returns true.
contract SimHeavyVerifyRule is SimBase {
    uint256 public immutable rounds;

    constructor(uint256 r) {
        rounds = r;
    }

    function __condition(bytes calldata, bytes calldata) external view onlyDelegated returns (bool) {
        bytes32 h;
        for (uint256 i = 0; i < rounds; i++) {
            h = keccak256(abi.encode(h, i));
        }
        return h != bytes32(0) || rounds == 0;
    }
}

/// @notice Condition WRITES storage (SSTORE during VERIFY, which is a static frame) and returns true.
contract SimWriteStorageRule is SimBase {
    bytes32 public constant SLOT = keccak256("popcorn.test.SimWriteStorageKernel.slot");

    // Not `view` on purpose: it executes SSTORE.
    function __condition(bytes calldata, bytes calldata) external onlyDelegated returns (bool) {
        bytes32 s = SLOT;
        assembly {
            sstore(s, 1)
        }
        return true;
    }
}

/// @notice Same read of another contract as SimReadOtherRule contract, but a RuleContract with a stake config: after its
///         built-in stake trigger the alt mempool admits the read (public ethrex still refuses it).
contract SimStakedReadRule is RuleContract {
    address public immutable target;
    uint256 internal immutable stakeAmount;

    constructor(address t, uint256 stakeAmount_) {
        target = t;
        stakeAmount = stakeAmount_;
    }

    function nonceKey(bytes calldata popArgs) internal view override returns (uint256) {
        return _hashKey(popArgs);
    }

    function condition(bytes calldata, bytes calldata) internal view override returns (bool) {
        (bool ok, bytes memory r) = target.staticcall{gas: 20_000}(abi.encodeCall(IValue.value, ()));
        return ok && r.length == 32 && abi.decode(r, (uint256)) > 0;
    }

    function action(bytes calldata, address) internal override {}

    function _stakeConfig() internal view override returns (address, uint256, uint32) {
        return (DEVNET_STAKING_REGISTRY, stakeAmount, 1);
    }
}
