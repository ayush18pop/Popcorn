// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPriceOracle {
    function price() external view returns (uint256);
}

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title SimpleLendingPool
/// @notice Demo Aave-style pool: ETH collateral, one ERC-20 debt token (the pool holds its liquidity).
///
///           collateralValue = collateral * oracle.price() / 1e18                 (debt-token units)
///           healthFactor    = collateralValue * LIQUIDATION_THRESHOLD / debt     (1e18 = 1.0; max uint if no debt)
///
///         LIQUIDATION_THRESHOLD = 0.8e18. Below 1.0 anyone may `liquidate` (repay all debt, take all collateral).
///         `positionNonce[user]` increases on every change of the user's position (deposit, borrow, repay, repayFor,
///         withdraw, liquidate). Zero amounts are refused (ZeroAmount): they would change nothing but the nonce.
contract SimpleLendingPool {
    uint256 public constant LIQUIDATION_THRESHOLD = 0.8e18;

    IPriceOracle public immutable oracle;
    IERC20Min public immutable debtToken;

    struct Position {
        uint128 collateral; // wei
        uint128 debt; // debt-token units
    }

    mapping(address => Position) public positions;
    mapping(address => uint256) public positionNonce;

    event Deposited(address indexed user, uint256 amount, uint256 nonce);
    event Borrowed(address indexed user, uint256 amount, uint256 nonce);
    event Repaid(address indexed user, address indexed payer, uint256 amount, uint256 nonce);
    event Withdrawn(address indexed user, uint256 amount, uint256 nonce);
    event Liquidated(address indexed user, address indexed liquidator, uint256 debt, uint256 collateral, uint256 nonce);

    error Unhealthy(uint256 healthFactor);
    error Healthy(uint256 healthFactor);
    error RepayTooMuch(uint256 amount, uint256 debt);
    error TransferFailed();
    error ZeroAmount();

    constructor(IPriceOracle oracle_, IERC20Min debtToken_) {
        oracle = oracle_;
        debtToken = debtToken_;
    }

    function healthFactor(address user) public view returns (uint256) {
        Position memory p = positions[user];
        if (p.debt == 0) return type(uint256).max;
        return (uint256(p.collateral) * oracle.price() / 1e18) * LIQUIDATION_THRESHOLD / p.debt;
    }

    /// @notice Everything a shield needs in one call: (collateral, debt, positionNonce, healthFactor).
    function position(address user) external view returns (uint256 collateral, uint256 debt, uint256 nonce, uint256 hf) {
        Position memory p = positions[user];
        return (p.collateral, p.debt, positionNonce[user], healthFactor(user));
    }

    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        positions[msg.sender].collateral += uint128(msg.value);
        emit Deposited(msg.sender, msg.value, ++positionNonce[msg.sender]);
    }

    /// @notice Borrow `amount`; the position must stay at health factor >= 1.0.
    function borrow(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        positions[msg.sender].debt += uint128(amount);
        uint256 hf = healthFactor(msg.sender);
        if (hf < 1e18) revert Unhealthy(hf);
        if (!debtToken.transfer(msg.sender, amount)) revert TransferFailed();
        emit Borrowed(msg.sender, amount, ++positionNonce[msg.sender]);
    }

    function repay(uint256 amount) external {
        _repay(msg.sender, amount);
    }

    /// @notice Anyone repays `amount` of `user`'s debt with their own tokens (approve the pool first).
    function repayFor(address user, uint256 amount) external {
        _repay(user, amount);
    }

    function withdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        positions[msg.sender].collateral -= uint128(amount);
        uint256 hf = healthFactor(msg.sender);
        if (hf < 1e18) revert Unhealthy(hf);
        emit Withdrawn(msg.sender, amount, ++positionNonce[msg.sender]);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Below health factor 1.0 anyone repays the whole debt and takes the whole collateral.
    function liquidate(address user) external {
        uint256 hf = healthFactor(user);
        if (hf >= 1e18) revert Healthy(hf);
        Position memory p = positions[user];
        delete positions[user];
        if (!debtToken.transferFrom(msg.sender, address(this), p.debt)) revert TransferFailed();
        emit Liquidated(user, msg.sender, p.debt, p.collateral, ++positionNonce[user]);
        (bool ok,) = msg.sender.call{value: p.collateral}("");
        if (!ok) revert TransferFailed();
    }

    function _repay(address user, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount(); // a free positionNonce bump would be a griefing tool
        Position storage p = positions[user];
        if (amount > p.debt) revert RepayTooMuch(amount, p.debt);
        p.debt -= uint128(amount);
        if (!debtToken.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Repaid(user, msg.sender, amount, ++positionNonce[user]);
    }
}
