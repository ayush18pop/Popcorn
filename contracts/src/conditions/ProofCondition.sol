// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleContract} from "src/rules/RuleContract.sol";
import {IVerifier} from "src/interfaces/IVerifier.sol";

/// @title ProofCondition (skeleton; the full version with ExploitBounty is )
/// @notice condition(popArgs, verifyData) = proofVerifier.verify(verifyData, _publicInputs(popArgs)).
///         verifyData is the VERIFY frame's data (the proof), chosen by the triggerer: the proof is only meaningful
///         because _publicInputs binds it to things the triggerer cannot choose (this rule contract's address and storage) and
///         to the popArgs the action will use (e.g. the recipient), so a proof for one recipient cannot pay another.
///         A verifier that reverts (or returns anything but true) makes the condition false.
///
///         Gas: a Groth16 verify is ~202k execution, so conditionGas must be ~215k+ and the rule contract's VERIFY
///         limit is >= 56,000 + conditionGas (Core floor): above the 250k unstaked budget of the local sidecar and the
///         100k public cap. A proof rule contract needs stake on the sidecar.
abstract contract ProofCondition is RuleContract {
    IVerifier public immutable proofVerifier;

    error ZeroVerifier();

    constructor(IVerifier verifier_) {
        if (address(verifier_) == address(0)) revert ZeroVerifier();
        proofVerifier = verifier_;
    }

    /// @notice The circuit's public inputs for this trigger, in the circuit's order. Build them from the rule contract's own
    ///         storage, address(this) and popArgs; never from verifyData.
    function _publicInputs(bytes calldata popArgs) internal view virtual returns (uint256[] memory);

    function condition(bytes calldata popArgs, bytes calldata verifyData) internal view virtual override returns (bool) {
        uint256[] memory inputs = _publicInputs(popArgs);
        // Low-level call: a revert or malformed return data is "false", never a revert of the condition itself.
        (bool s, bytes memory ret) = address(proofVerifier).staticcall(abi.encodeCall(IVerifier.verify, (verifyData, inputs)));
        return s && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
    }
}
