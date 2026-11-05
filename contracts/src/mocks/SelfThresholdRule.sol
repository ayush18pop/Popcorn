// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ThresholdCondition} from "src/conditions/ThresholdCondition.sol";
import {RulePays} from "src/payers/RulePays.sol";

/// @title SelfThresholdRule contract (test logic)
/// @notice A ThresholdCondition whose value lives in the RULE CONTRACT's own storage instead of another contract, so VERIFY
///         reads only sender storage: canonical on ethrex and no stake on the sidecar. Core accepts no normal call, so
///         the value is set by a trigger (anyone can: test fixture only, like FlagRule contract).
///           popArgs = abi.encode(uint256 cmd, uint256 arg)
///           cmd 0 FIRE : condition = value crossed the line; key = keccak256("popcorn.test.SelfThreshold.fire") (once);
///                        action records the value seen at FIRED_SLOT
///           cmd 1 SET  : condition true; key = _hashKey(popArgs); action stores arg at VALUE_SLOT
///                        (always true + a popArgs-derived key = anyone can make the rule contract pay for SET triggers without
///                        limit: acceptable for a test fixture only, never for a real rule contract)
contract SelfThresholdRule is ThresholdCondition, RulePays {
    /// @dev keccak256("popcorn.test.SelfThreshold.value")
    bytes32 public constant VALUE_SLOT = 0xd364d83a6e72e45e3858de11bd1a27f13049eeb12ea645871b40b78354a52d1e;
    bytes32 public constant FIRED_SLOT = keccak256("popcorn.test.SelfThreshold.fired");

    constructor(uint256 line, Direction direction) ThresholdCondition(address(1), bytes4(0), line, direction, 0) {}

    function _readThreshold() internal view override returns (bool, uint256) {
        return (true, _sload(VALUE_SLOT));
    }

    function nonceKey(bytes calldata popArgs) internal pure override returns (uint256) {
        return _word(popArgs, 0) == 0 ? uint256(keccak256("popcorn.test.SelfThreshold.fire")) : _hashKey(popArgs);
    }

    function condition(bytes calldata popArgs, bytes calldata) internal view override returns (bool) {
        uint256 cmd = _word(popArgs, 0);
        if (cmd == 1) return true;
        return cmd == 0 && condition();
    }

    function action(bytes calldata popArgs, address) internal override {
        if (_word(popArgs, 0) == 1) _sstore(VALUE_SLOT, _word(popArgs, 1));
        else _sstore(FIRED_SLOT, _sload(VALUE_SLOT));
    }
}
