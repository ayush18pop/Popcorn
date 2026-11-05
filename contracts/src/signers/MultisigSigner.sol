// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IntentSigner} from "src/signers/IntentSigner.sol";
import {Schemes} from "src/signers/lib/Schemes.sol";

/// @title MultisigSigner
/// @notice M-of-N over mixed schemes (ECDSA, P256, WebAuthn, WOTS+; ids and key/signature encodings in Schemes). Every signer signs
///         the same intent digest.
///
///         params   threshold (uint8) ++ n (uint8) ++ n x ( scheme (uint8) ++ key (Schemes.keyLength bytes) )
///         witness  count (uint8) ++ count x ( signerIndex (uint8) ++ sigLength (uint16) ++ sig )
///
///         Rules (all enforced; any violation returns false):
///           - 1 <= threshold <= n <= MAX_SIGNERS (16); params are consumed exactly (no trailing bytes)
///           - count == threshold exactly (the triggerer cannot pad; extra signatures only cost the rule contract data gas)
///           - signer indexes strictly increasing and < n: one signature per signer slot, in params order
///           - the configured keys must be pairwise distinct: `validParams` checks it (the SDK's encoder refuses duplicates);
///             a duplicate in the config would let one key fill two slots, so check it before deploying a rule contract
///           - WOTS+ signers use leaf = ruleEpoch - firstEpoch like WotsSigner and are bound to one chain id and rule id (160-byte key)
///           - distinctness is NOT enforced on chain: it would cost O(n^2) key hashes in every check (about 25k gas at n = 16) to guard a
///             deployer-side config mistake; `validParams` is the check, and the SDK's deploy helper calls it before every deploy
contract MultisigSigner is IntentSigner {
    uint256 public constant MAX_SIGNERS = 16;

    struct Intent {
        bytes32 digest;
        uint256 epoch;
        uint256 ruleId;
    }

    struct Cursor {
        uint256 p; // position in params
        uint256 slot; // signer entries walked so far
        uint256 w; // position in witness
    }

    function _check(address ruleContract, bytes calldata params, bytes calldata context, bytes calldata witness)
        internal
        view
        override
        returns (bool)
    {
        if (params.length < 2 || witness.length < 1) return false;
        uint256 threshold = uint8(params[0]);
        uint256 n = uint8(params[1]);
        if (threshold == 0 || threshold > n || n > MAX_SIGNERS || uint8(witness[0]) != threshold) return false;
        (bool ok, bytes32 digest, uint256 epoch, uint256 ruleId) = _intent(ruleContract, context);
        return ok && _run(params, witness, Intent(digest, epoch, ruleId), threshold, n);
    }

    function _run(bytes calldata params, bytes calldata witness, Intent memory it, uint256 threshold, uint256 n)
        private
        view
        returns (bool)
    {
        Cursor memory c = Cursor(2, 0, 1);
        int256 last = -1;
        for (uint256 i; i < threshold; ++i) {
            if (c.w + 3 > witness.length) return false;
            uint256 idx = uint8(witness[c.w]);
            if (int256(idx) <= last || idx >= n) return false;
            last = int256(idx);
            if (!_signer(params, witness, it, c, idx)) return false;
        }
        if (c.w != witness.length) return false;
        // the rest of params must be well formed too (so the config is unambiguous)
        if (!_skipTo(params, c, n)) return false;
        return c.p == params.length;
    }

    /// @dev advance the params cursor to signer `idx`, verify the signature entry at the witness cursor, advance it.
    function _signer(bytes calldata params, bytes calldata witness, Intent memory it, Cursor memory c, uint256 idx)
        private
        view
        returns (bool)
    {
        uint256 sLen = uint16(bytes2(witness[c.w + 1:c.w + 3]));
        if (c.w + 3 + sLen > witness.length || !_skipTo(params, c, idx) || c.p >= params.length) return false;
        uint8 scheme = uint8(params[c.p]);
        uint256 klen = Schemes.keyLength(scheme);
        if (klen == 0 || c.p + 1 + klen > params.length) return false;
        if (!_one(scheme, params[c.p + 1:c.p + 1 + klen], witness[c.w + 3:c.w + 3 + sLen], it)) return false;
        c.w += 3 + sLen;
        return true;
    }

    function _one(uint8 scheme, bytes calldata key, bytes calldata sig, Intent memory it) private view returns (bool) {
        return Schemes.verify(scheme, key, it.digest, it.epoch, it.ruleId, sig);
    }

    function _skipTo(bytes calldata params, Cursor memory c, uint256 target) private pure returns (bool) {
        while (c.slot < target) {
            if (c.p >= params.length) return false;
            uint256 kl = Schemes.keyLength(uint8(params[c.p]));
            if (kl == 0) return false;
            c.p += 1 + kl;
            ++c.slot;
        }
        return true;
    }

    /// @notice Off-chain/deploy-time check of a params blob: well formed, bounds, and pairwise distinct keys.
    function validParams(bytes calldata params) external pure returns (bool) {
        if (params.length < 2) return false;
        uint256 threshold = uint8(params[0]);
        uint256 n = uint8(params[1]);
        if (threshold == 0 || threshold > n || n > MAX_SIGNERS) return false;
        bytes32[MAX_SIGNERS] memory seen;
        uint256 cur = 2;
        for (uint256 i; i < n; ++i) {
            if (cur >= params.length) return false;
            uint8 scheme = uint8(params[cur]);
            uint256 kl = Schemes.keyLength(scheme);
            if (kl == 0 || cur + 1 + kl > params.length) return false;
            bytes32 h = keccak256(params[cur:cur + 1 + kl]);
            for (uint256 j; j < i; ++j) if (seen[j] == h) return false;
            seen[i] = h;
            cur += 1 + kl;
        }
        return cur == params.length;
    }
}
