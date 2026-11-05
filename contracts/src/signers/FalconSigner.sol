// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IntentSigner} from "src/signers/IntentSigner.sol";
import {hashToPointEVM} from "src/signers/vendor/ethfalcon/ZKNOX_HashToPoint.sol";
import {falcon_core} from "src/signers/vendor/ethfalcon/ZKNOX_falcon_core.sol";

/// @notice "This Falcon-512 key signed this intent" (post-quantum, lattice-based, stateless, many-time) through ZKNox's ETHFALCON verifier (MIT, vendored in
///         ./vendor/ethfalcon: Keccak-CTR hash-to-point + NTT-domain verification). NOT the NIST encoding: NIST Falcon hashes with SHAKE256, ETHFALCON with
///         keccak. Experimental upstream code (their README: not audited); its cost (about 1.5M VERIFY gas) fits only a staked budget.
///         params:  the public key in the NTT domain, 32 words (16 coefficients x 16 bits each) = 1,024 bytes
///         witness: salt (40 bytes) ++ s2 (32 words, same packing) = 1,064 bytes; message = the 32-byte intent digest
///         A malformed witness (length, coefficients >= q, norm above the bound) returns false.
contract FalconSigner is IntentSigner {
    function _check(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        internal
        view
        override
        returns (bool)
    {
        if (params.length != 1024 || witness.length != 1064) return false;
        (bool ok, bytes32 digest,,) = _intent(ruleContract, context);
        if (!ok) return false;
        return falcon_core(_words(witness[40:]), _words(params), hashToPointEVM(witness[0:40], abi.encodePacked(digest)));
    }

    function _words(bytes calldata b) private pure returns (uint256[] memory w) {
        w = new uint256[](32);
        for (uint256 i; i < 32; ++i) w[i] = uint256(bytes32(b[32 * i:32 * i + 32]));
    }
}
