// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IntentDigest
/// @notice The one digest every signature signer verifies (EIP-712 typed data, so a wallet's eth_signTypedData_v4
///         produces it too). Exact encoding (the SDK signers in packages/sdk produce the same):
///
///           context        = abi.encode(uint256 ruleId, uint256 ruleEpoch, bytes32 popArgsHash)       (96 bytes)
///                            popArgsHash = keccak256(popArgs) of the trigger being authorised
///           domainSep      = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("Popcorn Signed Intent"), keccak256("1"),
///                                                 block.chainid, rule contract))        rule contract = msg.sender of the predicate
///           structHash     = keccak256(abi.encode(INTENT_TYPEHASH, ruleId, ruleEpoch, popArgsHash))
///           digest         = keccak256(0x1901 ++ domainSep ++ structHash)
///
///           DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
///           INTENT_TYPEHASH = keccak256("PopcornIntent(uint256 ruleId,uint256 ruleEpoch,bytes32 popArgsHash)")
///
///         Attested facts (k-of-n) sign a second struct that also names the statement fixed in the predicate's params:
///           ATTEST_TYPEHASH = keccak256("PopcornAttestation(bytes32 statement,uint256 ruleId,uint256 ruleEpoch,bytes32 popArgsHash)")
///           structHash      = keccak256(abi.encode(ATTEST_TYPEHASH, statement, ruleId, ruleEpoch, popArgsHash))
///
///         What it binds: the chain (block.chainid), the rule contract, the rule, the rule's epoch and the exact popArgs. A
///         signature for another chain, rule contract, rule, epoch or action argument gives a different digest.
library IntentDigest {
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("Popcorn Signed Intent");
    bytes32 internal constant VERSION_HASH = keccak256("1");
    bytes32 internal constant INTENT_TYPEHASH = keccak256("PopcornIntent(uint256 ruleId,uint256 ruleEpoch,bytes32 popArgsHash)");
    bytes32 internal constant ATTEST_TYPEHASH =
        keccak256("PopcornAttestation(bytes32 statement,uint256 ruleId,uint256 ruleEpoch,bytes32 popArgsHash)");

    /// @notice Splits the caller's context. ok is false unless it is exactly 96 bytes.
    function parseContext(bytes calldata context)
        internal
        pure
        returns (bool ok, uint256 ruleId, uint256 ruleEpoch, bytes32 popArgsHash)
    {
        if (context.length != 96) return (false, 0, 0, 0);
        ruleId = uint256(bytes32(context[0:32]));
        ruleEpoch = uint256(bytes32(context[32:64]));
        popArgsHash = bytes32(context[64:96]);
        ok = true;
    }

    function domainSeparator(address ruleContract) internal view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, ruleContract));
    }

    function intentDigest(address ruleContract, uint256 ruleId, uint256 ruleEpoch, bytes32 popArgsHash)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(INTENT_TYPEHASH, ruleId, ruleEpoch, popArgsHash));
        return keccak256(abi.encodePacked(hex"1901", domainSeparator(ruleContract), structHash));
    }

    function attestationDigest(address ruleContract, bytes32 statement, uint256 ruleId, uint256 ruleEpoch, bytes32 popArgsHash)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(ATTEST_TYPEHASH, statement, ruleId, ruleEpoch, popArgsHash));
        return keccak256(abi.encodePacked(hex"1901", domainSeparator(ruleContract), structHash));
    }
}
