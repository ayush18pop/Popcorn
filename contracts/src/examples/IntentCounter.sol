// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignedIntentCondition} from "src/conditions/SignedIntentCondition.sol";
import {RulePays} from "src/payers/RulePays.sol";

/// @title IntentCounter
/// @notice The action half of the signed-intent examples: popArgs = abi.encode(uint256 ruleId, uint256 amount); the action adds `amount` to
///         the rule's counter. Two rules (0 and 1) so the replay tests can show that an intent signed for one rule cannot trigger the other.
///         The signature scheme comes from the trigger it is combined with (SignedIntentCounter: any predicate; the inline triggers:
///         ECDSA, WOTS+, FORS, XMSS).
abstract contract IntentCounter is SignedIntentCondition, RulePays {
    bytes32 private constant TOTAL = keccak256("popcorn.example.signedIntentCounter.total");
    uint256 public constant RULES = 2;

    error UnknownRule(uint256 ruleId);

    function total(uint256 ruleId) external view forwarded returns (uint256) {
        return _sload(keccak256(abi.encode(TOTAL, ruleId)));
    }

    function epoch(uint256 ruleId) external view forwarded returns (uint256) {
        return _ruleEpoch(ruleId);
    }

    function _ruleId(bytes calldata popArgs) internal pure virtual override returns (uint256 id) {
        id = _word(popArgs, 0);
        if (id >= RULES) revert UnknownRule(id);
    }

    function action(bytes calldata popArgs, address) internal virtual override {
        _consumeIntent(popArgs); // first: the epoch moves even if the rest changes
        bytes32 slot = keccak256(abi.encode(TOTAL, _word(popArgs, 0)));
        unchecked {
            _sstore(slot, _sload(slot) + _word(popArgs, 1));
        }
    }
}
