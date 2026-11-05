// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ICondition} from "src/interfaces/ICondition.sol";

/// @notice Test fixture for rule-set leaves: values, a flag, token balances anyone can set (never for real use).
contract MockGauge {
    uint256 public value;
    uint256 public other;
    bool public paused;
    uint8 public phase;
    mapping(address => uint256) public balanceOf;

    function setValue(uint256 v) external {
        value = v;
    }

    function setOther(uint256 v) external {
        other = v;
    }

    function setPaused(bool p) external {
        paused = p;
    }

    function setPhase(uint8 p) external {
        phase = p;
    }

    function setBalance(address a, uint256 v) external {
        balanceOf[a] = v;
    }

    /// @notice A call target for the CALL action: counts, records the last argument and the value received.
    uint256 public pings;
    uint256 public lastArg;
    uint256 public received;

    function ping(uint256 arg) external payable {
        ++pings;
        lastArg = arg;
        received += msg.value;
    }
}

contract MockReverter {
    fallback() external {
        revert("no");
    }
}

contract MockBurner {
    /// @dev Never returns: burns every unit of gas it is given without touching storage (so a STATICCALL runs until its gas cap).
    fallback() external {
        assembly {
            for {} 1 {} { mstore(0, keccak256(0, 64)) }
        }
    }
}

contract MockShortReturn {
    fallback() external {
        assembly {
            mstore(0, 7)
            return(0, 16)
        }
    }
}

/// @notice Predicate fixture. params = abi.encode(bytes32 witnessHash, bytes32 contextHash, address rule contract):
///         true iff keccak256(witness) == witnessHash, and (contextHash == 0 || keccak256(context) == contextHash),
///         and (rule contract == 0 || msg.sender == rule contract). It reads no storage, like a real predicate must.
contract MockSigner is ICondition {
    function check(bytes calldata params, bytes calldata context, bytes calldata witness) external view returns (bool) {
        if (params.length != 96) return false;
        (bytes32 wh, bytes32 ch, address ruleContract) = abi.decode(params, (bytes32, bytes32, address));
        if (keccak256(witness) != wh) return false;
        if (ch != 0 && keccak256(context) != ch) return false;
        if (ruleContract != address(0) && msg.sender != ruleContract) return false;
        return true;
    }
}

/// @notice A CALL-action target that can be switched to fail: act() reverts while `failing`, else counts.
contract MockToggle {
    bool public failing;
    uint256 public count;

    function setFailing(bool f) external {
        failing = f;
    }

    function act() external payable {
        require(!failing, "failing");
        ++count;
    }

    /// @dev Writes a fresh storage slot per call key (state gas probe for CALL actions).
    mapping(uint256 => uint256) public stored;

    function store(uint256 k, uint256 v) external {
        stored[k] = v;
    }
}
