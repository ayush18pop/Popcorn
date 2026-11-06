// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignedInstruction} from "src/blocks/checks/SignedInstruction.sol";
import {Answer} from "src/blocks/Answer.sol";

/// @title Statement Signed By k Of n Reporters (check block)
/// @notice yes when at least k of n named reporters signed that `statement` holds for this exact trigger. The statement is a
///         hash agreed off chain ("ETH/USD below 1,800", "the bridge halted", a receipt format); each reporter signs a digest
///         that also binds the chain, the build, the kind, its epoch and the trigger data, so a signature for one trigger
///         cannot be reused for another. Use it where the fact is not on chain, or as a second opinion next to Value Crosses
///         A Line (All Of: the oracle AND the reporters agree).
///
///         The signatures are checked by the stateless AttestedFactSigner (src/signers). Epochs and replay work exactly as in
///         Signed Instruction, which this block builds on: call `_useInstruction(kind)` first in the action.
///
///         witness = k x (reporterIndex u8 ++ r ++ s ++ v), indexes strictly increasing.
abstract contract ReporterStatement is SignedInstruction {
    /// @notice AttestedFactSigner's params: statement ++ k ++ n ++ n reporter addresses.
    function _reporterParams(bytes32 statement, uint8 k, address[] memory reporters) internal pure returns (bytes memory p) {
        p = abi.encodePacked(statement, k, uint8(reporters.length));
        for (uint256 i; i < reporters.length; i++) {
            p = abi.encodePacked(p, reporters[i]);
        }
    }

    /// @notice yes when k of `reporters` signed `statement` for (this build, kind, its epoch, popArgs).
    function _reportersSay(
        address attestedFactSigner,
        bytes32 statement,
        uint8 k,
        address[] memory reporters,
        uint256 kind,
        bytes calldata popArgs,
        bytes calldata witness
    ) internal view returns (Answer) {
        return _signedInstruction(attestedFactSigner, _reporterParams(statement, k, reporters), kind, popArgs, witness);
    }
}
