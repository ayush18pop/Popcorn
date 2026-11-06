// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPausable} from "src/interfaces/IPausable.sol";

/// A protocol with a pause switch that one pauser may flip (tests and SDK examples of Pause The Target on another contract).
contract MockPausable is IPausable {
    bool public paused;
    address public pauser;

    event Paused(address by);

    function setPauser(address p) external {
        require(pauser == address(0) || msg.sender == pauser, "pauser set");
        pauser = p;
    }

    function pause() external {
        require(msg.sender == pauser, "not the pauser");
        paused = true;
        emit Paused(msg.sender);
    }
}
