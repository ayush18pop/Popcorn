// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CallerPays} from "src/payers/CallerPays.sol";

/// @title OwnerRuleCP (test logic: the owner path of a SENDER-PAYS rule contract, Core mode 1)
/// @notice Same owner surface as OwnerRule contract on a rule contract that has no gas of its own: the payer pays the owner tx.
contract OwnerRuleCP is CallerPays {
    bytes32 public constant VALUE_SLOT = keccak256("popcorn.test.OwnerKernelSP.value");

    event ValueSet(uint256 value);

    function nonceKey(bytes calldata popArgs) internal pure override returns (uint256) {
        return _hashKey(popArgs);
    }

    function condition(bytes calldata, bytes calldata) internal pure override returns (bool) {
        return true;
    }

    function action(bytes calldata, address) internal override {}

    function setValue(uint256 v) external onlyOwnerCall {
        _sstore(VALUE_SLOT, v);
        emit ValueSet(v);
    }

    function value() external view returns (uint256) {
        return _sload(VALUE_SLOT);
    }
}
