// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {RulePays} from "src/payers/RulePays.sol";
import {Bouncer} from "src/mocks/Bouncer.sol";

/// @title ForwardRule contract (Core forward-path fixture, test only)
/// @notice Forwarded functions: `ping` (returns msg.sender/msg.value and a counter, payable), `set`, `boom` (custom
///         error), `lockedPing` (sets Core's lock slot then calls back through a Bouncer, as if inside __action).
///         Triggers: nonceKey = _hashKey(popArgs) (test only: unlimited paid triggers), condition true, action calls back
///         through the Bouncer named in popArgs word 0 (`set(7)` on the rule contract) and records the outcome:
///         RESULT_SLOT = 1 if the inner call succeeded, 2 + uint8(first byte of the 32-byte revert word) << 8 otherwise.
contract ForwardRule is RuleContract, RulePays {
    bytes32 public constant VALUE_SLOT = keccak256("popcorn.test.ForwardKernel.value");
    bytes32 public constant COUNT_SLOT = keccak256("popcorn.test.ForwardKernel.count");
    bytes32 public constant RESULT_SLOT = keccak256("popcorn.test.ForwardKernel.result");
    bytes32 internal constant LOCK = 0x9dd81f995770cdac1e5604925d6a5e0e08886ca48a9ea18085a511ab38ae2d13;

    error Boom(uint256 x);

    // ------------------------------------------------------------------ forwarded (ordinary calls)

    function ping(uint256 x) external payable forwarded returns (address sender, uint256 value, uint256 count, uint256 echo, bool inAction) {
        count = _sload(COUNT_SLOT) + 1;
        _sstore(COUNT_SLOT, count);
        return (msg.sender, msg.value, count, x, _inAction());
    }

    function set(uint256 v) external forwarded {
        _sstore(VALUE_SLOT, v);
    }

    function boom(uint256 x) external pure {
        revert Boom(x);
    }

    /// @notice Simulates "inside __action": sets Core's lock slot, calls back through the bouncer, clears it.
    function lockedPing(Bouncer b) external forwarded returns (bool ok, bytes memory ret) {
        assembly {
            tstore(LOCK, 1)
        }
        (ok, ret) = b.bounce(address(this), abi.encodeCall(this.set, (99)));
        assembly {
            tstore(LOCK, 0)
        }
    }

    // ------------------------------------------------------------------ trigger hooks

    function nonceKey(bytes calldata popArgs) internal pure override returns (uint256) {
        return _hashKey(popArgs);
    }

    function condition(bytes calldata, bytes calldata) internal pure override returns (bool) {
        return true;
    }

    function action(bytes calldata popArgs, address) internal override {
        Bouncer b = Bouncer(_address(popArgs, 0));
        (bool ok, bytes memory ret) = b.bounce(address(this), abi.encodeCall(this.set, (7)));
        uint256 r = 1;
        if (!ok) r = 2 | (ret.length == 32 ? uint256(bytes32(ret)) << 8 : 0xff << 8);
        _sstore(RESULT_SLOT, r);
    }
}
