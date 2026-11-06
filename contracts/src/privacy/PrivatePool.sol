// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "src/interfaces/IVerifier.sol";
import {IPoseidon2} from "src/privacy/IPoseidon.sol";
import {PoseidonTree} from "src/privacy/PoseidonTree.sol";
import {Payouts} from "src/privacy/Payouts.sol";
import {Flow, IPopcornExplain, FLOW_YES, FLOW_NO, FLOW_SKIPPED} from "src/rules/Explain.sol";
import {Answer, YES, NO, UNKNOWN, answer} from "src/blocks/Answer.sol";

/// @title PrivatePool
/// @notice A fixed-denomination private pool whose withdrawals pay their own gas. Rule-pays (Core mode 0).
///
///         The problem: a fresh withdrawal address has no ETH, so paying its gas links it to you, and a relayer is a
///         party that can refuse you. Here the pool is the transaction's sender and payer: the withdrawal carries a
///         proof, the pool's validation checks it, and the pool pays the gas out of the note (the fee stays in the pool).
///         Nobody signs, nobody relays, and the recipient needs no ETH.
///
///         Deposit (ordinary call): deposit(commitment) with exactly `denomination`; commitment = Poseidon(nullifier, secret).
///         Withdraw (trigger):
///           popArgs    = abi.encode(uint256 nullifierHash, uint256 root, uint256 assocRoot, address recipient, uint256 fee)
///           verifyData = the Groth16 proof (256 bytes) for circuits/withdraw.circom
///           nonceKey   = nullifierHash: EIP-8250 keyed nonces make the protocol itself refuse a second spend
///           condition  = root is a root this pool has had, assocRoot is an accepted association set, fee is within
///                        [minFee, denomination], and the proof verifies for [root, assocRoot, nullifierHash, recipient,
///                        fee, scope = this pool]
///           action     = send denomination - fee to the recipient (credited if the recipient refuses ETH)
///
///         Association sets: `associationProvider` publishes roots of trees of deposits it accepts. A withdrawal proves its
///         deposit is in one of them, so it shows it does not come from a flagged deposit without saying which deposit
///         it is. Validation reads only this pool's own storage and calls the verifier, whose code reads no storage.
///         The verifier is a separate contract, so the pool stakes (built-in stake trigger) for the alternative mempool.
///
///         Not post-quantum: Groth16 is zero-knowledge, and a quantum computer could forge its proofs.
contract PrivatePool is PoseidonTree, Payouts, IPopcornExplain {
    /// @dev keccak256("popcorn.privatePool"): association root r known at keccak256(abi.encode(r, BASE)).
    bytes32 private constant POOL = 0xcd097eeb3c4b2c41ecdd4385a1ccbee6dfe07012f16abad47592304368ea9bbd;
    uint256 internal constant R = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IVerifier public immutable verifier;
    uint256 public immutable denomination;
    /// @notice The least fee a withdrawal may carry: at least the most gas one withdrawal can cost the pool.
    uint256 public immutable minFee;
    address public immutable associationProvider;
    address internal immutable stakeRegistry;
    uint256 internal immutable stakeAmount;
    uint32 internal immutable stakeDelay;

    event Deposit(uint256 indexed commitment, uint256 index, uint256 root);
    event Withdrawal(uint256 indexed nullifierHash, address indexed recipient, uint256 amount, uint256 fee);
    event AssociationRoot(uint256 indexed root, bool accepted);

    error WrongDenomination();
    error BadCommitment();
    error NotProvider();
    error BadConfig();

    constructor(
        IVerifier verifier_,
        IPoseidon2 poseidon_,
        uint256 denomination_,
        uint256 minFee_,
        address associationProvider_,
        address stakeRegistry_,
        uint256 stakeAmount_,
        uint32 stakeDelay_
    ) PoseidonTree(poseidon_) {
        if (address(verifier_) == address(0) || associationProvider_ == address(0) || minFee_ > denomination_ || denomination_ == 0) {
            revert BadConfig();
        }
        verifier = verifier_;
        denomination = denomination_;
        minFee = minFee_;
        associationProvider = associationProvider_;
        stakeRegistry = stakeRegistry_;
        stakeAmount = stakeAmount_;
        stakeDelay = stakeDelay_;
    }

    function _stakeConfig() internal view override returns (address, uint256, uint32) {
        return (stakeRegistry, stakeAmount, stakeDelay);
    }

    // ------------------------------------------------------------------ deposits and association sets (ordinary calls)

    function deposit(uint256 commitment) external payable forwarded {
        if (msg.value != denomination) revert WrongDenomination();
        if (commitment == 0 || commitment >= R) revert BadCommitment();
        (uint256 index, uint256 root) = _insert(commitment);
        emit Deposit(commitment, index, root);
    }

    function setAssociationRoot(uint256 root, bool accepted) external forwarded {
        if (msg.sender != associationProvider) revert NotProvider();
        _sstore(_assocSlot(root), accepted ? 1 : 0);
        emit AssociationRoot(root, accepted);
    }

    function _assocSlot(uint256 root) private pure returns (bytes32) {
        return keccak256(abi.encode(root, POOL));
    }

    function currentRoot() external view forwarded returns (uint256) {
        return _currentRoot();
    }

    function leafCount() external view forwarded returns (uint256) {
        return _leafCount();
    }

    function isKnownRoot(uint256 root) external view forwarded returns (bool) {
        return _isKnownRoot(root);
    }

    function isAssociationRoot(uint256 root) external view forwarded returns (bool) {
        return _sload(_assocSlot(root)) == 1;
    }

    // ------------------------------------------------------------------ withdrawal (trigger)

    function _decode(bytes calldata popArgs) private pure returns (uint256 nullifierHash, uint256 root, uint256 assocRoot, address recipient, uint256 fee) {
        nullifierHash = _word(popArgs, 0);
        root = _word(popArgs, 1);
        assocRoot = _word(popArgs, 2);
        recipient = _address(popArgs, 3);
        fee = _word(popArgs, 4);
    }

    /// @dev The nullifier hash is bound to the proof, so each key has exactly one valid trigger (RuleContract notes).
    function nonceKey(bytes calldata popArgs) internal pure override returns (uint256) {
        return _word(popArgs, 0);
    }

    function condition(bytes calldata popArgs, bytes calldata verifyData) internal view override returns (bool) {
        if (popArgs.length != 160) return false;
        (uint256 nullifierHash, uint256 root, uint256 assocRoot, address recipient, uint256 fee) = _decode(popArgs);
        if (recipient == address(0) || fee < minFee || fee > denomination) return false;
        if (!_isKnownRoot(root) || _sload(_assocSlot(assocRoot)) != 1) return false;
        return _proofOk(nullifierHash, root, assocRoot, recipient, fee, verifyData).isYes();
    }

    /// @dev The withdraw proof against [root, assocRoot, nullifierHash, recipient, fee, scope = this pool]; shared by the
    ///      condition and the explain view so they cannot disagree.
    function _proofOk(uint256 nullifierHash, uint256 root, uint256 assocRoot, address recipient, uint256 fee, bytes calldata proof) private view returns (Answer) {
        uint256[] memory inputs = new uint256[](6);
        inputs[0] = root;
        inputs[1] = assocRoot;
        inputs[2] = nullifierHash;
        inputs[3] = uint256(uint160(recipient));
        inputs[4] = fee;
        inputs[5] = uint256(uint160(address(this)));
        (bool s, bytes memory ret) = address(verifier).staticcall(abi.encodeCall(IVerifier.verify, (proof, inputs)));
        if (!s || ret.length != 32) return UNKNOWN;
        return abi.decode(ret, (uint256)) == 1 ? YES : NO;
    }

    function action(bytes calldata popArgs, address) internal override {
        (uint256 nullifierHash,,, address recipient, uint256 fee) = _decode(popArgs);
        uint256 amount = denomination - fee;
        emit Withdrawal(nullifierHash, recipient, amount, fee);
        _sendOrCredit(recipient, amount);
    }

    // ------------------------------------------------------------------ explain (the explorer's flow, same order as condition)

    function popcornExplain(bytes calldata popArgs, bytes calldata verifyData) external view returns (string memory, string memory, bytes memory) {
        bool shaped = popArgs.length == 160 && uint256(bytes32(popArgs[96:128])) >> 160 == 0;
        uint8[4] memory r = _explainChecks(shaped, popArgs, verifyData);
        bool all = r[3] == FLOW_YES;
        uint8 and_ = r[2] == FLOW_YES ? r[3] : FLOW_NO;
        return (
            "withdraw",
            "t||Withdraw: nullifier, roots, recipient and fee, with a withdraw proof|;p|self-paying|the pool pays the gas, out of the note|0;c|compare|a recipient is set and the fee is within [minimum fee, denomination]|0;c||the deposit root is one this pool has had|0;c|membership-proof|the association set is an accepted one|0;c||the withdraw proof verifies (ZK): a deposit in the set, not yet spent, for this recipient and fee|0;o|and|AND|2,3,4,5;a||send denomination minus fee to the recipient|6",
            abi.encodePacked(Flow.result(answer(shaped)), FLOW_YES, r[0], r[1], r[2], r[3], and_, Flow.runs(all))
        );
    }

    /// @dev The four checks of the condition in order, each SKIPPED once an earlier one said no.
    function _explainChecks(bool shaped, bytes calldata popArgs, bytes calldata verifyData) private view returns (uint8[4] memory r) {
        r = [FLOW_SKIPPED, FLOW_SKIPPED, FLOW_SKIPPED, FLOW_SKIPPED];
        if (!shaped) return r;
        (uint256 nh, uint256 root, uint256 assoc, address to, uint256 fee) = _decode(popArgs);
        bool fees = to != address(0) && fee >= minFee && fee <= denomination;
        r[0] = fees ? FLOW_YES : FLOW_NO;
        if (!fees) return r;
        r[1] = _isKnownRoot(root) ? FLOW_YES : FLOW_NO;
        if (r[1] == FLOW_NO) return r;
        r[2] = _sload(_assocSlot(assoc)) == 1 ? FLOW_YES : FLOW_NO;
        if (r[2] == FLOW_NO) return r;
        r[3] = Flow.result(_proofOk(nh, root, assoc, to, fee, verifyData));
    }
}
