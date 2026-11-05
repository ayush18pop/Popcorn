// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {RulePays} from "src/payers/RulePays.sol";

/// @title ArmedCounter (the SDK README's rule-pays example)
/// @notice Anyone calls `arm()` (an ordinary transaction to the RULE CONTRACT address: Core forwards it to this logic). While armed
///         and under the limit, the rule contract's condition is true, so anyone, even a wallet with 0 ETH, can trigger it and the
///         RULE CONTRACT pays the gas. The trigger counts and disarms. The owner (hybrid ECDSA + WOTS+, optional) can change the limit.
///
///         Nonce key = keccak256("armed-counter", count): derived from state the ACTION advances, so each count value
///         allows exactly one paid trigger. Never derive it from popArgs alone (see RuleContract's notes).
///         The condition reads only the rule contract's own storage, so the public devnet's mempool accepts it.
contract ArmedCounter is RuleContract, RulePays {
    /// @dev ERC-7201-style slots: constants, never Solidity state variables (the logic runs in the RULE CONTRACT's storage).
    bytes32 private constant COUNT = keccak256("popcorn.example.armedCounter.count");
    bytes32 private constant ARMED = keccak256("popcorn.example.armedCounter.armed");
    bytes32 private constant LIMIT = keccak256("popcorn.example.armedCounter.limit");
    uint256 public constant DEFAULT_LIMIT = 3;

    event Armed(address by);
    event Popped(uint256 count, address payer);

    // ---- forwarded calls: the rule contract's public API (run in the rule contract's storage; never inside a trigger's action)

    function arm() external forwarded {
        _sstore(ARMED, 1);
        emit Armed(msg.sender);
    }

    function count() external view forwarded returns (uint256) {
        return _sload(COUNT);
    }

    function armed() external view forwarded returns (bool) {
        return _sload(ARMED) == 1;
    }

    function limit() public view forwarded returns (uint256 l) {
        l = _sload(LIMIT);
        return l == 0 ? DEFAULT_LIMIT : l;
    }

    /// @notice Owner-only (a hybrid-owner transaction, `ownerAction`): a normal call reverts NotOwnerCall.
    function setLimit(uint256 newLimit) external onlyOwnerCall {
        _sstore(LIMIT, newLimit);
    }

    // ---- the three hooks

    function nonceKey() internal view override returns (uint256) {
        return uint256(keccak256(abi.encode("armed-counter", _sload(COUNT))));
    }

    function condition() internal view override returns (bool) {
        uint256 l = _sload(LIMIT);
        return _sload(ARMED) == 1 && _sload(COUNT) < (l == 0 ? DEFAULT_LIMIT : l);
    }

    function action(bytes calldata, address payer_) internal override {
        uint256 c = _sload(COUNT) + 1;
        _sstore(COUNT, c);
        _sstore(ARMED, 0);
        emit Popped(c, payer_);
    }
}
