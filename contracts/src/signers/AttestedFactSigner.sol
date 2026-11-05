// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IntentSigner} from "src/signers/IntentSigner.sol";
import {IntentDigest} from "src/signers/IntentDigest.sol";
import {EcdsaLib} from "src/signers/lib/EcdsaLib.sol";

/// @title AttestedFactSigner
/// @notice k-of-n attested fact: at least k of n attestors signed "statement S holds for this exact trigger". The statement is
///         a hash fixed in the params (e.g. keccak256 of "ETH/USD above 5000 at block X" or of an off-chain receipt format); each
///         attestor signs the PopcornAttestation digest (IntentDigest.attestationDigest), which also binds chain, rule contract,
///         rule, epoch and popArgs, so an attestation for one trigger cannot be reused for another.
///
///         params   statement (bytes32) ++ k (uint8) ++ n (uint8) ++ n x attestor address (20 bytes)
///         witness  k x ( attestorIndex (uint8) ++ r ++ s ++ v (65 bytes) ), indexes strictly increasing
///
///         1 <= k <= n <= MAX_ATTESTORS (16); exactly k signatures (no padding); canonical ECDSA only (EcdsaLib). The attestor
///         addresses must be pairwise distinct (`validParams`).
contract AttestedFactSigner is IntentSigner {
    uint256 public constant MAX_ATTESTORS = 16;
    uint256 private constant ENTRY = 66;

    function _check(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        internal
        view
        override
        returns (bool)
    {
        if (params.length < 34) return false;
        uint256 k = uint8(params[32]);
        uint256 n = uint8(params[33]);
        if (k == 0 || k > n || n > MAX_ATTESTORS || params.length != 34 + 20 * n || witness.length != k * ENTRY) return false;
        (bool ok, bytes32 digest) = _attestation(ruleContract, bytes32(params[0:32]), context);
        return ok && _sigs(params, witness, digest, k, n);
    }

    function _attestation(address ruleContract, bytes32 statement, bytes calldata context) private view returns (bool ok, bytes32 digest) {
        uint256 ruleId;
        uint256 epoch;
        bytes32 argsHash;
        (ok, ruleId, epoch, argsHash) = IntentDigest.parseContext(context);
        if (ok) digest = IntentDigest.attestationDigest(ruleContract, statement, ruleId, epoch, argsHash);
    }

    function _sigs(bytes calldata params, bytes calldata witness, bytes32 digest, uint256 k, uint256 n) private view returns (bool) {
        int256 last = -1;
        for (uint256 i; i < k; ++i) {
            uint256 idx = uint8(witness[i * ENTRY]);
            if (int256(idx) <= last || idx >= n) return false;
            last = int256(idx);
            if (!_one(params, witness, digest, idx, i * ENTRY)) return false;
        }
        return true;
    }

    function _one(bytes calldata params, bytes calldata witness, bytes32 digest, uint256 idx, uint256 o) private view returns (bool) {
        return EcdsaLib.verify(address(bytes20(params[34 + 20 * idx:54 + 20 * idx])), digest, witness[o + 1:o + ENTRY]);
    }

    function validParams(bytes calldata params) external pure returns (bool) {
        if (params.length < 34) return false;
        uint256 k = uint8(params[32]);
        uint256 n = uint8(params[33]);
        if (k == 0 || k > n || n > MAX_ATTESTORS || params.length != 34 + 20 * n) return false;
        for (uint256 i; i < n; ++i) {
            address a = address(bytes20(params[34 + 20 * i:54 + 20 * i]));
            if (a == address(0)) return false;
            for (uint256 j; j < i; ++j) if (a == address(bytes20(params[34 + 20 * j:54 + 20 * j]))) return false;
        }
        return true;
    }
}
