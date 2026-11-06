// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// A deliberately buggy ETH vault for demos (small enough to deploy anywhere). Shares track deposits; withdraw has the
/// Demo Vault's rounding bug: it computes the shares to burn as amount * (S / T), and S / T truncates to 0 once yield has
/// made T larger than S, so a withdrawal burns no shares and assets per share fall. A pauser (a Popcorn build) can stop it.
contract BuggyVault {
    uint256 public totalAssets;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    bool public paused;
    address public pauser;

    error Paused();
    error NotPauser();
    error TooMuch();

    function setPauser(address p) external {
        if (pauser != address(0)) revert NotPauser();
        pauser = p;
    }

    function pause() external {
        if (msg.sender != pauser) revert NotPauser();
        paused = true;
    }

    function deposit() external payable {
        if (paused) revert Paused();
        uint256 shares = totalSupply == 0 ? msg.value : msg.value * totalSupply / totalAssets;
        totalAssets += msg.value;
        totalSupply += shares;
        balanceOf[msg.sender] += shares;
    }

    /// Yield: adds assets without new shares.
    function donate() external payable {
        totalAssets += msg.value;
    }

    function maxWithdraw(address o) public view returns (uint256) {
        return totalSupply == 0 ? 0 : balanceOf[o] * totalAssets / totalSupply;
    }

    /// THE BUG: rate = S / T truncates (to 0 when T > S), so the burn is amount * 0.
    function withdraw(uint256 amount) external {
        if (paused) revert Paused();
        if (amount > maxWithdraw(msg.sender)) revert TooMuch();
        uint256 shares = amount * (totalSupply / totalAssets);
        balanceOf[msg.sender] -= shares;
        totalSupply -= shares;
        totalAssets -= amount;
        payable(msg.sender).transfer(amount);
    }
}
