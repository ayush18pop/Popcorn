// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIntentScheme} from "src/signers/IIntentScheme.sol";
import {IntentSigner} from "src/signers/IntentSigner.sol";
import {Schemes} from "src/signers/lib/Schemes.sol";

/// @title HybridEcdsaSigner
/// @notice ECDSA AND any other scheme (FORS, XMSS/LMS-style, SPHINCS+, Falcon, P256, ...): both must verify over the same
///         digest. The inner scheme is another IIntentScheme contract, named in params and called with `checkFor(rule contract, ...)`
///         so its signatures stay bound to the rule contract. Costs the inner scheme + about 5k (one more call).
///         params:  ecdsa address (20) ++ inner scheme contract (20) ++ inner params (rest)
///         witness: r ++ s ++ v (65) ++ inner witness (rest)
///         The params are the rule contract's own configuration (fixed when it is deployed), so the inner address is trusted like
///         the predicate address itself.
contract HybridEcdsaSigner is IntentSigner {
    function _check(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        internal
        view
        override
        returns (bool)
    {
        if (params.length < 40 || witness.length < 65) return false;
        (bool ok, bytes32 digest, uint256 epoch, uint256 ruleId) = _intent(ruleContract, context);
        if (!ok || !Schemes.verify(Schemes.ECDSA, params[0:20], digest, epoch, ruleId, witness[0:65])) return false;
        (bool s, bytes memory ret) = address(bytes20(params[20:40])).staticcall(
            abi.encodeCall(IIntentScheme.checkFor, (ruleContract, params[40:], context, witness[65:]))
        );
        return s && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
    }
}
