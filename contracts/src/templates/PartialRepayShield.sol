// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CallerPays} from "src/payers/CallerPays.sol";

interface IShieldPool {
    function position(address user) external view returns (uint256 collateral, uint256 debt, uint256 nonce, uint256 hf);
    function positionNonce(address user) external view returns (uint256);
    function repayFor(address user, uint256 amount) external;
}

interface IShieldToken {
    function balanceOf(address) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title PartialRepayShield
/// @notice A caller-pays rule contract (Core mode 1) that keeps `user`'s loan on `pool` healthy. The rule contract holds a reserve
///         of the debt token (the user sends it there). When the loan is unhealthy, ANYONE can trigger it and pay the gas: the
///         rule contract repays a quarter of the debt from its reserve and pays the triggerer (the payer Core passed in) a reward of
///         0.5% of the repaid amount. No keeper, no owner call.
///
///           nonceKey  = keccak256(SHIELD_KEY_DOMAIN ++ user ++ rescueEpoch)      (the rule contract's OWN storage)
///           condition = popArgs empty && debt > 0 && healthFactor(user) < threshold
///                       && token.balanceOf(rule contract) >= amount + reward,  amount = debt * repayBps / 10000,
///                                                                      reward  = amount * rewardBps / 10000
///           action    = rescueEpoch += 1 FIRST; then, best effort, the same checks again, approve + pool.repayFor(user,
///                       amount), _payReward(token, reward) (itself best effort). If anything fails the action records it
///                       (RescueSkipped) and RETURNS: it never reverts.
///
///         Key design: the key is a rescue epoch the rule contract owns and only its own action advances, so
///         nobody outside can invalidate a pending rescue (v1 keyed on pool.positionNonce, which anyone could bump with
///         repayFor(user, 0) / 1 wei for free and void every pending trigger). Each trigger is ONE rescue step: it consumes the
///         current epoch's key and moves to the next, so a trigger can never be replayed, and a copy of a pending trigger competes
///         for the same key (one of them lands). While the loan stays below the threshold the next epoch is valid again:
///         a rescue chain, one quarter of the remaining debt per trigger, until the loan is healthy (or the reserve runs
///         out). Because the action advances the epoch before anything that can fail and never reverts, a failed
///         repayment can never brick the shield: the next trigger simply uses the next epoch. A payer who triggers when the
///         rescue can no longer succeed (e.g. the reserve was withdrawn in between) pays for a no-op; VERIFY prevents that
///         at the time it runs, and isReady() shows it.
///
///         The user (and only the user) can take the reserve back with the forwarded `withdrawReserve(to, amount)`.
///
///         Mempool: the condition reads the pool, the oracle and the token (other contracts' storage), so the rule contract must
///         be STAKED for the sidecar (built-in stake trigger, `stakeAmount` > 0), and public ethrex never includes it
///         (StorageReadNonSender): it is included on a devnet whose sidecar relays staked triggers.
///         Every external read in VERIFY has a fixed gas stipend (no GAS opcode) and fails closed.
contract PartialRepayShield is CallerPays {
    /// @dev keccak256("popcorn.shield.positionKey")
    bytes32 public constant SHIELD_KEY_DOMAIN = keccak256("popcorn.shield.positionKey");
    uint256 public constant POSITION_READ_GAS = 25_000;
    uint256 public constant BALANCE_READ_GAS = 6_000;

    IShieldPool public immutable pool;
    IShieldToken public immutable token;
    address public immutable user;
    uint256 public immutable threshold; // 1e18 = health factor 1.0; the demo uses 1.1e18
    uint256 public immutable repayBps; // 2500 = a quarter
    uint256 public immutable rewardBps; // 50 = 0.5%
    uint256 internal immutable stakeAmount;
    uint32 internal immutable stakeDelay;

    /// @dev keccak256("popcorn.shield.rescueEpoch"): the rule contract's rescue epoch (the nonce key's only state).
    bytes32 public constant RESCUE_EPOCH_SLOT = keccak256("popcorn.shield.rescueEpoch");

    event Rescued(address indexed user, address indexed payer, uint256 repaid, uint256 reward, uint256 healthFactorBefore, uint256 epoch);
    /// @notice A trigger whose rescue could not proceed (reason: 1 not rescuable / reserve short, 2 approve failed, 3 repay failed).
    event RescueSkipped(address indexed payer, uint256 epoch, uint8 reason);
    event ReserveWithdrawn(address indexed to, uint256 amount);

    error NotRescuable();
    error BadConfig();
    error NotUser();
    error WithdrawFailed();

    constructor(
        IShieldPool pool_,
        IShieldToken token_,
        address user_,
        uint256 threshold_,
        uint256 repayBps_,
        uint256 rewardBps_,
        uint256 stakeAmount_,
        uint32 stakeDelay_
    ) {
        if (address(pool_) == address(0) || address(token_) == address(0) || user_ == address(0)) revert BadConfig();
        if (repayBps_ == 0 || repayBps_ > 10_000 || rewardBps_ > 1_000 || threshold_ <= 1e18) revert BadConfig();
        pool = pool_;
        token = token_;
        user = user_;
        threshold = threshold_;
        repayBps = repayBps_;
        rewardBps = rewardBps_;
        stakeAmount = stakeAmount_;
        stakeDelay = stakeDelay_;
    }

    // ------------------------------------------------------------------ hooks

    function nonceKey() internal view override returns (uint256) {
        return shieldKey(_sload(RESCUE_EPOCH_SLOT));
    }

    /// @notice The nonce key of the rescue at rescueEpoch == epoch_ (for the SDK and the tests).
    function shieldKey(uint256 epoch_) public view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(SHIELD_KEY_DOMAIN, user, epoch_)));
    }

    /// @notice The rule contract's rescue epoch (call it on the rule contract; forwarded).
    function rescueEpoch() external view forwarded returns (uint256) {
        return _sload(RESCUE_EPOCH_SLOT);
    }

    /// @notice The user takes (part of) the reserve back. Only `user`; forwarded (Core refuses it while a trigger's action runs).
    function withdrawReserve(address to, uint256 amount) external forwarded {
        if (msg.sender != user) revert NotUser();
        if (!token.transfer(to, amount)) revert WithdrawFailed();
        emit ReserveWithdrawn(to, amount);
    }

    function condition(bytes calldata popArgs, bytes calldata) internal view override returns (bool) {
        if (popArgs.length != 0) return false;
        (bool ok,, uint256 amount, uint256 reward) = _rescue();
        return ok && _reserve() >= amount + reward;
    }

    /// @dev Never reverts: the epoch moves first, every external call is low-level and checked.
    function action(bytes calldata, address payer_) internal override {
        uint256 epoch = _sload(RESCUE_EPOCH_SLOT) + 1;
        _sstore(RESCUE_EPOCH_SLOT, epoch);
        (bool ok, uint256 hf, uint256 amount, uint256 reward) = _rescue();
        if (!ok || _reserve() < amount + reward) return _skip(payer_, epoch, 1);
        (bool a,) = address(token).call(abi.encodeWithSelector(IShieldToken.approve.selector, address(pool), amount));
        if (!a) return _skip(payer_, epoch, 2);
        (bool r,) = address(pool).call(abi.encodeWithSelector(IShieldPool.repayFor.selector, user, amount));
        if (!r) {
            (bool z,) = address(token).call(abi.encodeWithSelector(IShieldToken.approve.selector, address(pool), 0));
            z; // best effort: clear the allowance
            return _skip(payer_, epoch, 3);
        }
        _payReward(address(token), reward);
        emit Rescued(user, payer_, amount, reward, hf, epoch);
    }

    function _skip(address payer_, uint256 epoch, uint8 reason) private {
        emit RescueSkipped(payer_, epoch, reason);
    }

    function _stakeConfig() internal view override returns (address, uint256, uint32) {
        return (DEVNET_STAKING_REGISTRY, stakeAmount, stakeDelay);
    }

    // ------------------------------------------------------------------ views (also for simulate()/the demo)

    /// @notice (rescuable, healthFactor, amount to repay, reward). Fails closed on any failed read.
    function _rescue() internal view returns (bool ok, uint256 hf, uint256 amount, uint256 reward) {
        (bool s, bytes memory ret) =
            address(pool).staticcall{gas: POSITION_READ_GAS}(abi.encodeWithSelector(IShieldPool.position.selector, user));
        if (!s || ret.length != 128) return (false, 0, 0, 0);
        (, uint256 debt,, uint256 h) = abi.decode(ret, (uint256, uint256, uint256, uint256));
        amount = debt * repayBps / 10_000;
        reward = amount * rewardBps / 10_000;
        ok = debt > 0 && amount > 0 && h < threshold;
        hf = h;
    }

    function _reserve() internal view returns (uint256 b) {
        (bool s, bytes memory ret) =
            address(token).staticcall{gas: BALANCE_READ_GAS}(abi.encodeWithSelector(IShieldToken.balanceOf.selector, address(this)));
        if (s && ret.length == 32) b = abi.decode(ret, (uint256));
    }

    /// @notice Pure rule, for tests and the UI: would a loan at health factor `hf` be rescued?
    function rescuableAt(uint256 hf) external view returns (bool) {
        return hf < threshold;
    }
}
