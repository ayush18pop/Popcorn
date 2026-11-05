// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IntentCounter} from "src/examples/IntentCounter.sol";

/// @title SignedIntentCounter (the SDK README's signed-intent example)
/// @notice A rule contract that adds `amount` to a counter when the configured key signed exactly that trigger: the signer never sends a
///         transaction and never pays gas; anyone (even a wallet with 0 ETH) submits the signed trigger and the RULE CONTRACT pays.
///         `predicate` is any signer (EcdsaSigner, WotsSigner, MultisigSigner, ...); its params are the code of the
///         `paramsBlob` contract (SDK: paramsBlobInitCode), read with EXTCODECOPY, so one logic contract serves every scheme.
///         For one fixed scheme prefer an inline trigger (EcdsaIntentCondition, WotsIntentCondition, ...): no predicate call, no blob.
contract SignedIntentCounter is IntentCounter {
    address public immutable predicate;
    address public immutable paramsBlob;

    constructor(address predicate_, address paramsBlob_) {
        predicate = predicate_;
        paramsBlob = paramsBlob_;
    }

    function _intentSigner(uint256) internal view override returns (address) {
        return predicate;
    }

    function _intentParams(uint256) internal view override returns (bytes memory) {
        return paramsBlob.code;
    }
}
