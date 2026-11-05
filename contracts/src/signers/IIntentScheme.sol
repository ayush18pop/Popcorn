// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICondition} from "src/interfaces/ICondition.sol";

/// @title IIntentScheme
/// @notice A signed-intent signer: `check` is ICondition (the rule contract is msg.sender); `checkFor` is the same
///         check with the rule contract named explicitly, so that a wrapper predicate (hybrid ECDSA + X) can call an inner scheme
///         on behalf of the rule contract. `checkFor` is a pure view function of its arguments: naming another rule contract only
///         changes which rule contract's digest is checked, it grants nothing.
///         The signed digest is defined once in IntentDigest.
interface IIntentScheme is ICondition {
    function checkFor(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        external
        view
        returns (bool);
}
