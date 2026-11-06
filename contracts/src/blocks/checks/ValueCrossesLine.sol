// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {Answer, UNKNOWN, answer} from "src/blocks/Answer.sol";
import {cmpProducts} from "src/rules/RuleSet.sol";

/// @title Value Crosses A Line (check block)
/// @notice Is a number above or below a line? The number can come from the build's own storage (canonical, public
///         mempool), from a getter on another contract (needs a staked build on the alternative mempool), or be a ratio of
///         two numbers (share price = assets / shares) compared without division, so nothing rounds.
///
///         Presets, all this one block: share price below a floor, loan health factor below 1.1, oracle price outside a
///         band, a stablecoin off its peg.
///
///         A read that reverts, runs out of its gas cap or returns too little is UNKNOWN, never no and never yes.
abstract contract ValueCrossesLine is RuleContract {
    enum Side {
        Above,
        Below
    }

    /// @notice yes when `value` is strictly beyond `line` on `side`.
    function _crossesLine(uint256 value, uint256 line, Side side) internal pure returns (Answer) {
        return answer(side == Side.Above ? value > line : value < line);
    }

    /// @notice yes when `value` is outside [lo, hi] (two lines: a band, a peg).
    function _outsideBand(uint256 value, uint256 lo, uint256 hi) internal pure returns (Answer) {
        return answer(value < lo || value > hi);
    }

    /// @notice yes when num / den is strictly beyond line / scale on `side`, compared as num * scale against den * line
    ///         in 512 bits (no division, no overflow). Share price below a floor of M per 1e18:
    ///         _ratioCrossesLine(totalAssets, totalSupply, M, 1e18, Side.Below).
    function _ratioCrossesLine(uint256 num, uint256 den, uint256 line, uint256 scale, Side side) internal pure returns (Answer) {
        uint256 c = cmpProducts(num, scale, den, line); // 0 less, 1 equal, 2 greater
        return answer(side == Side.Above ? c == 2 : c == 0);
    }

    /// @notice Word `index` of what `target` returns for `callData`, read with at most `gasCap` gas. ok is false when the
    ///         call reverted or returned fewer than (index + 1) words. Reads another contract's storage: see the notes.
    function _readWord(address target, bytes memory callData, uint256 index, uint256 gasCap) internal view returns (bool ok, uint256 v) {
        bool s;
        uint256 size;
        assembly ("memory-safe") {
            s := staticcall(gasCap, target, add(callData, 0x20), mload(callData), 0, 0)
            size := returndatasize()
        }
        if (!s || size < 32 * (index + 1)) return (false, 0);
        assembly ("memory-safe") {
            returndatacopy(0, mul(index, 32), 32)
            v := mload(0)
        }
        return (true, v);
    }

    /// @notice The getter read and the line in one: unknown when the read fails.
    function _getterCrossesLine(address target, bytes memory callData, uint256 index, uint256 gasCap, uint256 line, Side side)
        internal
        view
        returns (Answer)
    {
        (bool ok, uint256 v) = _readWord(target, callData, index, gasCap);
        if (!ok) return UNKNOWN;
        return _crossesLine(v, line, side);
    }

    /// @notice A word of the build's own storage, shifted and masked (packed fields). Never unknown: own storage always reads.
    function _ownValue(bytes32 slot, uint256 shift, uint256 mask) internal view returns (uint256) {
        return (_sload(slot) >> shift) & mask;
    }
}
