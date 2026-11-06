// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {TokenOut} from "src/blocks/TokenOut.sol";

/// @title Pay The Reward (action block)
/// @notice A public reward pool that anyone can fund, paid out by the build's action: the smaller of the reward asked for
///         and what is in the pool, in ETH or one ERC-20 (`rewardToken`, address(0) = ETH).
///
///         WHO GETS PAID decides whether the reward is safe (decision 7). A pending trigger carries no signature, so a mempool
///         watcher can copy it and change its data. Pay:
///           - the recipient bound inside a proof (Proof That The Rules Were Broken): a copier cannot change it; or
///           - the gas payer (use Payer Gets Rewarded, the CallerPays payer, instead of this block); or
///           - an address named in the trigger data only for a small "thank you" reward, knowing it can be copied.
///
///         Never reverts the action: a payment that fails (the token or the receiver refuses) stays in the pool and is
///         reported in an event. A token pool is apart from everything else the build holds. An ETH pool is only a
///         counter over the build's balance, which also pays the gas when the build pays it (Contract Pays The Gas): keep
///         the balance above the pool plus the gas reserve, or a payout fails and is reported (RewardNotPaid).
///
///         The function is `_payFromPool`, not `_payReward`, so a build can hold this block and Payer Gets Rewarded
///         (CallerPays._payReward, which pays the gas payer) together.
abstract contract PayTheReward is RuleContract {
    /// @dev slot 0: the pool.
    bytes32 private constant POOL = keccak256("popcorn.block.payTheReward");
    /// @notice Gas given to the reward transfer (ETH to a contract, or an ERC-20 transfer).
    uint256 public constant REWARD_GAS = 100_000;

    address public immutable rewardToken;

    event RewardsFunded(address indexed from, uint256 amount);
    event RewardPaid(address indexed to, uint256 amount);
    event RewardNotPaid(address indexed to, uint256 amount);

    error WrongFunding();

    constructor(address rewardToken_) {
        rewardToken = rewardToken_;
    }

    /// @notice Adds to the pool. ETH pool: send the amount as value. Token pool: approve the build first.
    function fundRewards(uint256 amount) external payable forwarded {
        if (rewardToken == address(0)) {
            if (msg.value != amount) revert WrongFunding();
        } else if (msg.value != 0 || !TokenOut.pull(rewardToken, msg.sender, amount)) {
            revert WrongFunding();
        }
        _sstore(POOL, _sload(POOL) + amount);
        emit RewardsFunded(msg.sender, amount);
    }

    function rewardPool() public view returns (uint256) {
        return _sload(POOL);
    }

    /// @notice Pays min(want, pool) to `to`, best effort. Returns what was paid (0 when nothing was).
    function _payFromPool(address to, uint256 want) internal returns (uint256 paid) {
        uint256 pool = _sload(POOL);
        uint256 amount = want < pool ? want : pool;
        if (amount == 0 || to == address(0) || to == address(this)) return 0;
        _sstore(POOL, pool - amount);
        if (TokenOut.send(rewardToken, to, amount, REWARD_GAS)) {
            emit RewardPaid(to, amount);
            return amount;
        }
        _sstore(POOL, pool);
        emit RewardNotPaid(to, amount);
        return 0;
    }
}
