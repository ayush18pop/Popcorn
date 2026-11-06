// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {Answer, NO, answer} from "src/blocks/Answer.sol";
import {cmpProducts} from "src/rules/RuleSet.sol";

/// @title Value Moves Too Fast (check block)
/// @notice Has a number moved more than `bps` (basis points) away from the value it had last time? The block remembers a
///         baseline per watched value (`id`) in the build's own storage; the build's action moves the baseline forward with
///         `_rememberValue` when it fires, so the next trigger measures from there.
///
///         Presets: outflow spike (assets dropped 20% since the last check), price jump, supply mint spike.
///
///         A baseline of zero means "not set yet": the answer is no until the build sets one (`_rememberValue` in a setup
///         call), so a fresh build never fires on its first reading.
abstract contract ValueMovesTooFast is RuleContract {
    enum Move {
        Up,
        Down,
        Either
    }

    /// @dev baseline(id) at keccak256(abi.encode(id, BASE)).
    bytes32 private constant BASE = keccak256("popcorn.block.valueMovesTooFast");

    event BaselineMoved(uint256 indexed id, uint256 value);

    function _baselineSlot(uint256 id) private pure returns (bytes32) {
        return keccak256(abi.encode(id, BASE));
    }

    /// @notice The value `id` is measured from (0 = not set).
    function _baseline(uint256 id) internal view returns (uint256) {
        return _sload(_baselineSlot(id));
    }

    /// @notice Sets the baseline of `id` to `value` (in a setup call, or in the action when the build fires).
    function _rememberValue(uint256 id, uint256 value) internal {
        _sstore(_baselineSlot(id), value);
        emit BaselineMoved(id, value);
    }

    /// @notice yes when `value` moved more than `bps` / 10,000 of the baseline in direction `move`. Compared as
    ///         |value - baseline| * 10,000 > bps * baseline in 512 bits.
    function _movedTooFast(uint256 id, uint256 value, uint256 bps, Move move) internal view returns (Answer) {
        uint256 b = _baseline(id);
        if (b == 0) return NO;
        bool up = value > b;
        if (value == b || (move == Move.Up && !up) || (move == Move.Down && up)) return NO;
        uint256 diff = up ? value - b : b - value;
        return answer(cmpProducts(diff, 10_000, bps, b) == 2);
    }
}
