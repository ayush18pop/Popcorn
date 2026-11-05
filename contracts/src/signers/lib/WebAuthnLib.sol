// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {P256Lib} from "src/signers/lib/P256Lib.sol";

/// @title WebAuthnLib
/// @notice WebAuthn assertion (navigator.credentials.get) check on a P-256 passkey. The authenticator signs
///         sha256(authenticatorData ++ sha256(clientDataJSON)); the relying party's challenge is the 32-byte intent digest,
///         which the browser puts into clientDataJSON as base64url (no padding).
///
///         Witness layout (packed, our own; the triggerer supplies the two JSON offsets so no JSON is parsed on chain):
///           r (32) ++ s (32) ++ typeIndex (uint16) ++ challengeIndex (uint16) ++ authLength (uint16)
///           ++ authenticatorData (authLength bytes) ++ clientDataJSON (the rest)
///         Checks: authenticatorData >= 37 bytes; flag UP (0x01) set; flag UV (0x04) set when requireUV; rpIdHash equal to
///         the configured one when that is non-zero; clientDataJSON holds `"type":"webauthn.get"` at typeIndex and
///         `"challenge":"<base64url(digest)>"` at challengeIndex (the exact 57 bytes); low-s P-256 signature.
///         The approach (offsets, base64url challenge, flags) follows the public designs of Daimo's P256 verifier,
///         Coinbase's WebAuthn.sol and OpenZeppelin's WebAuthn.sol (all MIT); no code is copied.
library WebAuthnLib {
    uint8 internal constant FLAG_UP = 0x01;
    uint8 internal constant FLAG_UV = 0x04;
    uint256 internal constant HEADER = 70; // r, s, typeIndex, challengeIndex, authLength
    bytes internal constant TYPE_FIELD = '"type":"webauthn.get"';
    bytes internal constant CHALLENGE_PREFIX = '"challenge":"';
    bytes internal constant B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    /// @param key  x ++ y ++ rpIdHash ++ flags (128 bytes; rpIdHash 0 = not checked; flags bit 0 = require user verification)
    function verify(bytes32 digest, bytes calldata key, bytes calldata w) internal view returns (bool) {
        if (w.length < HEADER + 37) return false;
        uint256 authLen = uint16(bytes2(w[68:70]));
        if (authLen < 37 || HEADER + authLen > w.length) return false;
        if (!_authOk(w[HEADER:HEADER + authLen], bytes32(key[64:96]), uint256(bytes32(key[96:128])) & 1 == 1)) return false;
        if (!_clientOk(digest, w[HEADER + authLen:], uint16(bytes2(w[64:66])), uint16(bytes2(w[66:68])))) return false;
        bytes32 h = sha256(abi.encodePacked(w[HEADER:HEADER + authLen], sha256(w[HEADER + authLen:])));
        return P256Lib.verify(h, uint256(bytes32(w[0:32])), uint256(bytes32(w[32:64])), uint256(bytes32(key[0:32])), uint256(bytes32(key[32:64])));
    }

    function _authOk(bytes calldata auth, bytes32 rpIdHash, bool requireUV) internal pure returns (bool) {
        uint8 flags = uint8(auth[32]);
        if (flags & FLAG_UP == 0) return false;
        if (requireUV && flags & FLAG_UV == 0) return false;
        return rpIdHash == bytes32(0) || bytes32(auth[0:32]) == rpIdHash;
    }

    function _clientOk(bytes32 digest, bytes calldata json, uint256 typeIdx, uint256 chIdx) internal pure returns (bool) {
        if (typeIdx + 21 > json.length || chIdx + 57 > json.length) return false;
        if (keccak256(json[typeIdx:typeIdx + 21]) != keccak256(TYPE_FIELD)) return false;
        return keccak256(json[chIdx:chIdx + 57]) == keccak256(abi.encodePacked(CHALLENGE_PREFIX, _b64url(digest), '"'));
    }

    /// @notice base64url (no padding) of 32 bytes = 43 characters.
    function _b64url(bytes32 v) internal pure returns (bytes memory out) {
        bytes memory T = B64URL;
        out = new bytes(43);
        uint256 o;
        for (uint256 i; i < 30; i += 3) {
            uint256 n = (uint256(uint8(v[i])) << 16) | (uint256(uint8(v[i + 1])) << 8) | uint256(uint8(v[i + 2]));
            out[o++] = T[(n >> 18) & 63];
            out[o++] = T[(n >> 12) & 63];
            out[o++] = T[(n >> 6) & 63];
            out[o++] = T[n & 63];
        }
        uint256 t = (uint256(uint8(v[30])) << 8) | uint256(uint8(v[31])); // 16 bits -> 3 chars
        out[o++] = T[(t >> 10) & 63];
        out[o++] = T[(t >> 4) & 63];
        out[o++] = T[(t << 2) & 63];
    }
}
