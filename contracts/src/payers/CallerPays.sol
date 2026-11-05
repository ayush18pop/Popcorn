// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";

/// @title CallerPays
/// @notice Base for the logic of a caller-pays rule contract (Core mode 1). A separate payer's VERIFY frame (frame 1)
///         pays the gas; the rule contract's own VERIFY approves execution only, so a trigger never costs the rule contract gas. Core reads
///         the payer as FRAMEPARAM(target, 1) and passes it to __action, which RuleContract keeps in a
///         transient slot (`_payer()`).
///
///         `_payReward(token, amount)` pays THAT payer and nobody else. It never reads popArgs: a mempool observer who
///         copies a pending trigger must pay the gas itself to change who gets the reward, so the reward always goes to whoever
///         actually paid for the trigger. The payer signs the whole tx (EOA payer: signatures[1] over the
///         signature hash), so nobody can swap the payer of a signed trigger either.
///
///         AN ACTION MUST NEVER REVERT FOR A REASON THE PAYER CONTROLS. The key is consumed
///         at the payer's APPROVE, before the action runs; if the action reverts, the key is gone and whatever the action
///         would have advanced (an epoch the next key is derived from) is not, so a rule contract whose key only advances in its
///         action is bricked forever. The payer chooses its own code: a payer contract can refuse ETH (e.g. the minimal
///         "APPROVE on every call" payer reverts on any plain call) or a token can refuse the payer. So `_payReward` is
///         BEST EFFORT: ETH is sent with a fixed stipend (BONUS_ETH_GAS), an ERC-20 `transfer` with a fixed gas
///         (BONUS_TOKEN_GAS) and no return data copied beyond one word; if either fails, the amount is credited to
///         `rewardOwed(token, payer)` (pull payment, `claimReward(token, to)`, a forwarded function). It never reverts
///         because of the payer. Budget ONE fresh storage slot (97,920 state gas) in maxStateGasPerFrame for the owed
///         record, or the action can still fail on state gas.
///
///         Deploy the logic with mode 1 (RuleFactory checks `popcornMode()` against the args). Under a mode-0
///         (rule-pays) rule contract Core would pass payer = the rule contract, and `_payReward` reverts (PayerIsRule contract) instead of
///         paying the rule contract itself (a deployment error, not something a payer controls).
abstract contract CallerPays is RuleContract {
    /// @notice Gas forwarded with an ETH reward (an EOA needs none; a contract payer's receive must fit in it).
    uint256 public constant BONUS_ETH_GAS = 10_000;
    /// @notice Gas forwarded to an ERC-20 reward transfer (execution gas; a fresh balance slot draws on state gas).
    uint256 public constant BONUS_TOKEN_GAS = 100_000;
    /// @dev keccak256("popcorn.senderpays.owed"): owed(token, payer) at keccak256(abi.encode(token, payer, OWED_SLOT)).
    bytes32 internal constant OWED_SLOT = keccak256("popcorn.senderpays.owed");

    error NoPayer();
    error PayerIsRule();
    error NothingOwed();
    error ClaimFailed(address token, address to, uint256 amount);

    event RewardPaid(address indexed payer, address indexed token, uint256 amount);
    /// @notice The reward could not be delivered (the payer or the token refused it): it is owed, claim with claimReward.
    event RewardOwed(address indexed payer, address indexed token, uint256 amount, uint256 totalOwed);
    event RewardClaimed(address indexed payer, address indexed token, address to, uint256 amount);

    /// @notice Core `mode` this logic expects (1 = caller-pays). Called on the logic contract by the factory and the SDK.
    function popcornMode() external pure returns (uint8) {
        return 1;
    }

    /// @notice Pays `amount` of `token` (address(0) = ETH) from the rule contract to the payer Core passed to __action, best
    ///         effort (see the contract notes): on failure the amount is owed to the payer instead. Only inside __action.
    function _payReward(address token, uint256 amount) internal virtual {
        address p = _payer();
        if (p == address(0)) revert NoPayer();
        if (p == address(this)) revert PayerIsRule();
        if (amount == 0) return;
        if (_transferOut(token, p, amount, token == address(0) ? BONUS_ETH_GAS : BONUS_TOKEN_GAS)) {
            emit RewardPaid(p, token, amount);
        } else {
            uint256 total = _owed(token, p) + amount;
            _setOwed(token, p, total);
            emit RewardOwed(p, token, amount, total);
        }
    }

    /// @notice What the rule contract owes `payer` in `token` (address(0) = ETH): rewards that could not be delivered.
    function rewardOwed(address token, address payer) external view forwarded returns (uint256) {
        return _owed(token, payer);
    }

    /// @notice The caller (a payer) takes its owed reward in `token`, sent to `to` with all gas. Forwarded.
    function claimReward(address token, address to) external forwarded {
        uint256 a = _owed(token, msg.sender);
        if (a == 0) revert NothingOwed();
        _setOwed(token, msg.sender, 0);
        if (!_transferOut(token, to, a, gasleft())) revert ClaimFailed(token, to, a);
        emit RewardClaimed(msg.sender, token, to, a);
    }

    // ------------------------------------------------------------------ internals

    /// @dev ETH: CALL with `g` gas, no return data copied. ERC-20: transfer(to, amount) with `g` gas, success iff the call
    ///      succeeded and returned nothing (from a contract) or one word == 1; at most 32 bytes of return data copied.
    function _transferOut(address token, address to, uint256 amount, uint256 g) internal returns (bool ok) {
        if (token == address(0)) {
            assembly ("memory-safe") {
                ok := call(g, to, amount, 0, 0, 0, 0)
            }
            return ok;
        }
        bytes memory data = abi.encodeWithSelector(0xa9059cbb, to, amount); // transfer(address,uint256)
        uint256 rs;
        uint256 word;
        assembly ("memory-safe") {
            ok := call(g, token, 0, add(data, 0x20), mload(data), 0, 0x20)
            rs := returndatasize()
            word := mload(0)
        }
        ok = ok && (rs == 0 ? token.code.length > 0 : (rs >= 32 && word == 1));
    }

    function _owedSlot(address token, address payer) private pure returns (bytes32) {
        return keccak256(abi.encode(token, payer, OWED_SLOT));
    }

    function _owed(address token, address payer) internal view returns (uint256) {
        return _sload(_owedSlot(token, payer));
    }

    function _setOwed(address token, address payer, uint256 v) private {
        _sstore(_owedSlot(token, payer), v);
    }
}
