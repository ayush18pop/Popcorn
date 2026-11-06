// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {Answer, answer} from "src/blocks/Answer.sol";

/// @title Contract Code Changed (check block)
/// @notice yes when `target`'s code hash is no longer the one recorded when the build was set up: its code was replaced
///         (a metamorphic redeploy, an upgrade that swaps the code itself). Reads code, not storage.
///
///         What it cannot watch: both mempools refuse a validation read of an account with no code or with an EIP-7702
///         delegation, so a self-destruct or a changed delegation makes the trigger inadmissible (it fails closed: the
///         build never fires on it). For a proxy whose implementation lives in a storage slot, watch the implementation's address with
///         Value Crosses A Line instead.
///
///         Preset: upgrade tripwire (exit or pause the moment a protocol you rely on is upgraded).
abstract contract ContractCodeChanged is RuleContract {
    function _codeChanged(address target, bytes32 recorded) internal view returns (Answer) {
        return answer(target.codehash != recorded);
    }
}
