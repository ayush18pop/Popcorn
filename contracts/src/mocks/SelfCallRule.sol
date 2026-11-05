// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";

/// @title SelfCallRule contract (Core regression fixture, test only)
/// @notice A plausible logic: a forwarded batch helper that CALLs address(this) for each item (multicall-by-CALL). Under
///         Core a `pop(bytes)` item, reached from another account's SENDER frame, ran __action with no VERIFY.
///         Its triggers are never valid (condition false); FIRED counts __action runs.
///         `batch` never reverts: for each item it records the outcome in LAST_SLOT (1 = the self-call succeeded, else
///         the first 32 bytes of the revert data, e.g. Core's word 0x3b), so a devnet tx keeps the evidence on chain.
contract SelfCallRule is RuleContract {
    bytes32 public constant FIRED = keccak256("popcorn.test.SelfCallKernel.fired");
    bytes32 public constant LAST_SLOT = keccak256("popcorn.test.SelfCallKernel.last");

    function batch(bytes[] calldata calls) external forwarded returns (uint256 last) {
        for (uint256 i; i < calls.length; i++) {
            (bool ok, bytes memory r) = address(this).call(calls[i]);
            last = ok ? 1 : (r.length >= 32 ? uint256(bytes32(r)) : 0xff);
        }
        _sstore(LAST_SLOT, last);
    }

    function nonceKey(bytes calldata) internal pure override returns (uint256) {
        return 1;
    }

    function condition(bytes calldata, bytes calldata) internal pure override returns (bool) {
        return false; // never a valid trigger
    }

    function action(bytes calldata, address) internal override {
        _sstore(FIRED, _sload(FIRED) + 1);
    }
}
