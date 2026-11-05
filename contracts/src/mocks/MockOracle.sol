// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockOracle
/// @notice Demo price feed for SimpleLendingPool: `price` = debt-token units (18 decimals) per 1 ETH of collateral.
///         Only the owner (the demo operator) sets it; `shield-crash.ts` drops it to make a loan unhealthy.
contract MockOracle {
    address public immutable owner = msg.sender;
    uint256 public price;

    event PriceSet(uint256 price);

    error NotOwner();

    constructor(uint256 price_) {
        price = price_;
        emit PriceSet(price_);
    }

    function setPrice(uint256 price_) external {
        if (msg.sender != owner) revert NotOwner();
        price = price_;
        emit PriceSet(price_);
    }
}
