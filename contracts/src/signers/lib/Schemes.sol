// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EcdsaLib} from "src/signers/lib/EcdsaLib.sol";
import {P256Lib} from "src/signers/lib/P256Lib.sol";
import {WebAuthnLib} from "src/signers/lib/WebAuthnLib.sol";
import {WotsLib} from "src/signers/lib/WotsLib.sol";

/// @title Schemes
/// @notice The signature schemes a multisig signer can use, with ONE key encoding and ONE witness encoding each. The
///         single-scheme predicates use the same encodings as their params and witness.
///
///           id  scheme     key (params)                                          signature (witness)
///           0   ECDSA      address, 20 bytes                                     r ++ s ++ v, 65 bytes
///           1   P256       x ++ y, 64 bytes                                      r ++ s, 64 bytes
///           2   WebAuthn   x ++ y ++ rpIdHash ++ flags(uint256), 128 bytes       see WebAuthnLib; flags bit 0 = require UV
///           3   WOTS+      root ++ pubSeed ++ firstEpoch ++ chainId ++ ruleId, 160 bytes   salt (32) ++ 67 chains ++ 10 path nodes, 2,496 bytes
///
///         WOTS+ is stateful: its leaf is ruleEpoch - firstEpoch (ruleEpoch >= firstEpoch, < 1,024), and the signed
///         message is keccak256(digest ++ salt). The key is BOUND on chain to one chain id and one rule id (params): a context for another
///         rule or chain is refused, so two rules (or chains) can never ask one leaf for two different messages. The rule contract cannot be
///         bound on chain (its address depends on the logic that holds the key: a hash cycle); the SDK signer binds a key to one
///         (chainId, rule contract, ruleId) in its usage store. Never use the Core owner's WOTS+ tree as an intent key. The salt is free for the signer (randomised hashing, and a way to pick a
///         digest with fewer hash steps).
library Schemes {
    uint8 internal constant ECDSA = 0;
    uint8 internal constant P256 = 1;
    uint8 internal constant WEBAUTHN = 2;
    uint8 internal constant WOTS = 3;

    uint256 internal constant ECDSA_KEY = 20;
    uint256 internal constant P256_KEY = 64;
    uint256 internal constant WEBAUTHN_KEY = 128;
    uint256 internal constant WOTS_KEY = 160;
    uint256 internal constant WOTS_WITNESS = 2496;

    /// @return length of the key of `scheme`, 0 for an unknown scheme.
    function keyLength(uint8 scheme) internal pure returns (uint256) {
        if (scheme == ECDSA) return ECDSA_KEY;
        if (scheme == P256) return P256_KEY;
        if (scheme == WEBAUTHN) return WEBAUTHN_KEY;
        if (scheme == WOTS) return WOTS_KEY;
        return 0;
    }

    /// @notice Verify `sig` over `digest` with `key` of `scheme`. False on any malformed input (never reverts on it).
    function verify(uint8 scheme, bytes calldata key, bytes32 digest, uint256 epoch, uint256 ruleId, bytes calldata sig)
        internal
        view
        returns (bool)
    {
        if (key.length != keyLength(scheme)) return false;
        if (scheme == ECDSA) return EcdsaLib.verify(address(bytes20(key)), digest, sig);
        if (scheme == P256) {
            if (sig.length != 64) return false;
            return P256Lib.verify(digest, uint256(bytes32(sig[0:32])), uint256(bytes32(sig[32:64])), uint256(bytes32(key[0:32])), uint256(bytes32(key[32:64])));
        }
        if (scheme == WEBAUTHN) {
            return WebAuthnLib.verify(digest, key, sig);
        }
        return verifyWots(key, digest, epoch, ruleId, sig);
    }

    function verifyWots(bytes calldata key, bytes32 digest, uint256 epoch, uint256 ruleId, bytes calldata sig)
        internal
        view
        returns (bool)
    {
        return verifyWots(
            bytes32(key[0:32]), bytes32(key[32:64]), uint256(bytes32(key[64:96])), uint256(bytes32(key[96:128])), uint256(bytes32(key[128:160])), digest, epoch, ruleId, sig
        );
    }

    /// @notice WOTS+ with the key given as values (the inline trigger keeps them as immutables). Refuses another chain id or rule id than the key is bound to.
    function verifyWots(
        bytes32 root,
        bytes32 pubSeed,
        uint256 firstEpoch,
        uint256 boundChainId,
        uint256 boundRuleId,
        bytes32 digest,
        uint256 epoch,
        uint256 ruleId,
        bytes calldata sig
    ) internal view returns (bool) {
        if (sig.length != WOTS_WITNESS || epoch < firstEpoch || block.chainid != boundChainId || ruleId != boundRuleId) return false;
        bytes32 m = keccak256(abi.encodePacked(digest, bytes32(sig[0:32])));
        return WotsLib.verify(root, pubSeed, epoch - firstEpoch, m, sig[32:]);
    }
}
