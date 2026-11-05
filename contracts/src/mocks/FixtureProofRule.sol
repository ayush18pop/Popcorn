// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ProofCondition} from "src/conditions/ProofCondition.sol";
import {RulePays} from "src/payers/RulePays.sol";
import {IVerifier} from "src/interfaces/IVerifier.sol";

/// @title FixtureProofRule contract (measurement only)
/// @notice A ProofCondition whose public inputs come straight from popArgs = abi.encode(uint256[3] inputs, uint256 salt),
///         so a fixture proof (whose inputs name another vault) verifies. Never use this pattern for real:
///         inputs taken from popArgs bind nothing. nonceKey = keccak256(popArgs). action: nothing.
contract FixtureProofRule is ProofCondition, RulePays {
    constructor(IVerifier v) ProofCondition(v) {}

    function _publicInputs(bytes calldata popArgs) internal pure override returns (uint256[] memory inputs) {
        inputs = new uint256[](3);
        for (uint256 i; i < 3; i++) {
            inputs[i] = _word(popArgs, i);
        }
    }

    function nonceKey(bytes calldata popArgs) internal pure override returns (uint256) {
        return _hashKey(popArgs);
    }

    function action(bytes calldata, address) internal override {}
}
