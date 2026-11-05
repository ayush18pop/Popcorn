// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CallerPays} from "src/payers/CallerPays.sol";

/// @notice TEST ONLY: a caller-pays rule contract whose condition reads only its own storage, so public ethrex
///         includes its triggers. Anyone arms it with the forwarded `arm()`; a trigger then pays BONUS wei to the payer Core
///         passed in, records that payer and disarms.
///           nonceKey  = keccak256(KEY_DOMAIN ++ epoch)       (epoch advances with every trigger)
///           condition = armed
///           action    = disarm, epoch += 1, lastPayer = payer, _payReward(ETH, BONUS)
///         popArgs is free (up to the rule contract's cap) and ignored: a copy with other popArgs is the same trigger.
contract RewardRule is CallerPays {
    uint256 public constant BONUS = 1e12 wei;
    /// @dev keccak256("popcorn.test.RewardRule contract.state"): bit 0 armed, bits 1.. epoch
    bytes32 public constant STATE = keccak256("popcorn.test.BonusKernel.state");
    bytes32 public constant LAST_PAYER = keccak256("popcorn.test.BonusKernel.lastPayer");
    bytes32 public constant KEY_DOMAIN = keccak256("popcorn.test.BonusKernel.key");

    event Popped(address indexed payer, uint256 epoch);

    function arm() external forwarded {
        _sstore(STATE, _sload(STATE) | 1);
    }

    function epoch() public view returns (uint256) {
        return _sload(STATE) >> 1;
    }

    function nonceKey() internal view override returns (uint256) {
        return uint256(keccak256(abi.encodePacked(KEY_DOMAIN, _sload(STATE) >> 1)));
    }

    function condition() internal view override returns (bool) {
        return _sload(STATE) & 1 == 1;
    }

    function action(bytes calldata, address payer_) internal override {
        uint256 e = (_sload(STATE) >> 1) + 1;
        _sstore(STATE, e << 1);
        _sstore(LAST_PAYER, uint256(uint160(payer_)));
        _payReward(address(0), BONUS);
        emit Popped(payer_, e);
    }
}
