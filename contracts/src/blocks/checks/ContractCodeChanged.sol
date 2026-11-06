// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {Answer, answer} from "src/blocks/Answer.sol";

/// @title Contract Code Changed (check block)
/// @notice yes when `target`'s code hash is no longer the one recorded when the build was set up: the contract was
///         upgraded (an EIP-7702 delegation changed, a proxy's code was replaced) or self-destructed. Reads code, not
///         storage. For a proxy whose implementation lives in a storage slot, watch the implementation's address with
///         Value Crosses A Line instead.
///
///         Preset: upgrade tripwire (exit or pause the moment a protocol you rely on is upgraded).
abstract contract ContractCodeChanged is RuleContract {
    function _codeChanged(address target, bytes32 recorded) internal view returns (Answer) {
        return answer(target.codehash != recorded);
    }
}
