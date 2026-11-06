// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "src/interfaces/IVerifier.sol";
import {IIntentScheme} from "src/signers/IIntentScheme.sol";
import {Payouts} from "src/privacy/Payouts.sol";
import {RuleContract} from "src/rules/RuleContract.sol";
import {HiddenGuardians} from "src/account/HiddenGuardians.sol";

/// @title SovereignAccount
/// @notice A wallet account that keeps working when the things around it fail: a broken key scheme, a guardian
///         takeover, a missing gas balance. Rule-pays (Core mode 0) and staked: the account is the sender and payer of
///         its own transactions, and anyone may submit them, from a key with no ETH.
///
///         Modules it is assembled from, each with one job:
///           owner signer     ECDSA AND Falcon-512 over the same intent digest (HybridEcdsaSigner + FalconSigner). The
///                            owner's params are kept as a hash and supplied with each spend, so rotating them is one write.
///           quantum switch   a flag that, once flipped (by the owner or a guardian quorum), refuses every owner spend;
///                            only the committed post-quantum backup key (WOTS+, committed as a hash, never revealed
///                            until used) can then move the funds, once, to a target it signs.
///           hidden guardians k-of-n private membership votes (HiddenGuardians) that can rotate the owner or flip the
///                            quantum switch, without revealing which guardians voted.
///           forced exit      a rotation by guardians waits RECOVERY_DELAY; if the current owner contests it in that window,
///                            the account is marked contested and anyone may trigger the exit: every wei goes to the exit
///                            address committed at initialisation. Contested control ends with the funds at the owner's
///                            own safe address, never with whoever won the vote.
///           private balance  the account deposits into and withdraws from a PrivatePool and receives on a StealthVault
///                            through ordinary spends; those modules pay their own gas.
///
///         Triggers (popArgs word 0 = kind):
///           1 SPEND    abi.encode(1, to, value, data)          verifyData = abi.encode(ownerParams, witness)
///           2 VOTE     abi.encode(2, proposal, nullifierHash)  verifyData = the membership proof
///           3 EXIT     abi.encode(3)                           verifyData empty
///           4 MIGRATE  abi.encode(4, target)                   verifyData = abi.encode(backupParams, wotsWitness)
///           5 QUANTUM  abi.encode(5)                           verifyData = abi.encode(ownerParams, witness)
///         Ordinary calls: initialize (once, by the deployer), finalizeRecovery (anyone, after the delay), contest (the
///         owner's signature), deposit (anyone, plain ETH works too).
///
///         Proposals: the new owner params hash (a rotation), or PROPOSAL_QUANTUM = keccak256(abi.encode("quantum")).
///         Validation reads only this account's storage and calls the signer and verifier contracts (code, no storage),
///         so the account stakes for the alternative mempool, whose 2,500,000 staked budget covers Falcon (~1.5M).
contract SovereignAccount is HiddenGuardians, Payouts {
    /// @dev keccak256("popcorn.sovereign"): +0 initialized, +1 ownerParamsHash, +2 spendEpoch, +3 quantum, +4 exited,
    ///      +5 contested, +6 pendingOwnerParamsHash, +7 pendingReadyAt, +8 exitAddress, +9 backupParamsHash
    bytes32 private constant S = 0x5542024517e38735ed6fbb9df053c6714287f521892b7853486d9d792c2b2cc9;

    uint256 public constant KIND_SPEND = 1;
    uint256 public constant KIND_VOTE = 2;
    uint256 public constant KIND_EXIT = 3;
    uint256 public constant KIND_MIGRATE = 4;
    uint256 public constant KIND_QUANTUM = 5;
    /// @notice Intent rule ids (IntentDigest ruleId) for the owner's and the backup key's signatures.
    uint256 public constant RULE_SPEND = 1;
    uint256 public constant RULE_QUANTUM = 5;
    uint256 public constant RULE_CONTEST = 6;
    uint256 public constant RULE_MIGRATE = 4;
    bytes32 public constant PROPOSAL_QUANTUM = keccak256(abi.encode("quantum"));

    IIntentScheme public immutable ownerScheme;
    IIntentScheme public immutable backupScheme;
    address public immutable deployer;
    uint256 public immutable recoveryDelay;
    address internal immutable stakeRegistry;
    uint256 internal immutable stakeAmount;
    uint32 internal immutable stakeDelay;

    event Initialized(bytes32 ownerParamsHash, address exitAddress, bytes32 backupParamsHash, uint256 guardiansRoot, uint256 threshold);
    event Spend(uint256 indexed epoch, address indexed to, uint256 value, bool success);
    event QuantumSwitched(bool byGuardians);
    event RotationPending(bytes32 newOwnerParamsHash, uint256 readyAt);
    event Rotated(bytes32 newOwnerParamsHash);
    event Contested();
    event Exited(address indexed to, uint256 amount);
    event Migrated(address indexed to, uint256 amount);

    error AlreadyInitialized();
    error NotDeployer();
    error NoPendingRecovery();
    error TooEarly();
    error IsContested();
    error BadSignature();

    constructor(
        IIntentScheme ownerScheme_,
        IIntentScheme backupScheme_,
        IVerifier membershipVerifier_,
        uint256 recoveryDelay_,
        address deployer_,
        address stakeRegistry_,
        uint256 stakeAmount_,
        uint32 stakeDelay_
    ) HiddenGuardians(membershipVerifier_) {
        ownerScheme = ownerScheme_;
        backupScheme = backupScheme_;
        recoveryDelay = recoveryDelay_;
        deployer = deployer_;
        stakeRegistry = stakeRegistry_;
        stakeAmount = stakeAmount_;
        stakeDelay = stakeDelay_;
    }

    function _stakeConfig() internal view override returns (address, uint256, uint32) {
        return (stakeRegistry, stakeAmount, stakeDelay);
    }

    function _s(uint256 i) private pure returns (bytes32) {
        return bytes32(uint256(S) + i);
    }

    // ------------------------------------------------------------------ ordinary calls

    /// @notice One-time setup by the deployer: owner params hash, exit address, backup key hash, guardians.
    function initialize(bytes32 ownerParamsHash, address exitAddress, bytes32 backupParamsHash, uint256 guardiansRoot_, uint256 threshold)
        external
        forwarded
    {
        if (msg.sender != deployer) revert NotDeployer();
        if (_sload(_s(0)) != 0) revert AlreadyInitialized();
        _sstore(_s(0), 1);
        _sstore(_s(1), uint256(ownerParamsHash));
        _sstore(_s(8), uint256(uint160(exitAddress)));
        _sstore(_s(9), uint256(backupParamsHash));
        _setGuardians(guardiansRoot_, threshold);
        emit Initialized(ownerParamsHash, exitAddress, backupParamsHash, guardiansRoot_, threshold);
    }

    function deposit() external payable forwarded {}

    /// @notice After the delay, anyone completes an uncontested rotation.
    function finalizeRecovery() external forwarded {
        bytes32 pending = bytes32(_sload(_s(6)));
        if (pending == 0) revert NoPendingRecovery();
        if (_sload(_s(5)) != 0) revert IsContested();
        if (block.timestamp < _sload(_s(7))) revert TooEarly();
        _sstore(_s(1), uint256(pending));
        _sstore(_s(6), 0);
        _sstore(_s(7), 0);
        emit Rotated(pending);
    }

    /// @notice The current owner contests a pending rotation by signing (rule RULE_CONTEST, epoch = guardian round):
    ///         the rotation is dropped and the account is contested, which opens the forced exit to anyone.
    function contest(bytes calldata ownerParams, bytes calldata witness) external forwarded {
        if (_sload(_s(6)) == 0) revert NoPendingRecovery();
        bytes memory context = abi.encode(RULE_CONTEST, guardianRound(), keccak256("contest"));
        if (keccak256(ownerParams) != bytes32(_sload(_s(1))) || !_schemeOk(ownerScheme, ownerParams, context, witness)) {
            revert BadSignature();
        }
        _sstore(_s(6), 0);
        _sstore(_s(7), 0);
        _sstore(_s(5), 1);
        emit Contested();
    }

    function state()
        external
        view
        forwarded
        returns (bytes32 ownerParamsHash, uint256 spendEpoch, bool quantum, bool exited, bool contested, bytes32 pendingOwner, uint256 pendingReadyAt, address exitAddress)
    {
        return (
            bytes32(_sload(_s(1))),
            _sload(_s(2)),
            _sload(_s(3)) == 1,
            _sload(_s(4)) == 1,
            _sload(_s(5)) == 1,
            bytes32(_sload(_s(6))),
            _sload(_s(7)),
            address(uint160(_sload(_s(8))))
        );
    }

    // ------------------------------------------------------------------ triggers

    function nonceKey(bytes calldata popArgs) internal view override returns (uint256) {
        uint256 kind = _word(popArgs, 0);
        if (kind == KIND_SPEND) return uint256(keccak256(abi.encode("spend", _sload(_s(2)))));
        if (kind == KIND_VOTE) return _word(popArgs, 2); // the nullifier hash, bound to the proof
        if (kind == KIND_EXIT) return uint256(keccak256("exit"));
        if (kind == KIND_MIGRATE) return uint256(keccak256("migrate"));
        if (kind == KIND_QUANTUM) return uint256(keccak256("quantum"));
        return 0; // Core refuses a zero key
    }

    function condition(bytes calldata popArgs, bytes calldata verifyData) internal view override returns (bool) {
        if (_sload(_s(0)) != 1 || _sload(_s(4)) == 1) return false; // not initialised, or the funds already left
        uint256 kind = _word(popArgs, 0);
        if (kind == KIND_SPEND) {
            if (_sload(_s(3)) == 1) return false; // the quantum switch refuses every owner spend
            return _ownerSigned(RULE_SPEND, _sload(_s(2)), popArgs, verifyData);
        }
        if (kind == KIND_VOTE) {
            if (popArgs.length != 96) return false;
            return _voteValid(bytes32(_word(popArgs, 1)), _word(popArgs, 2), verifyData);
        }
        if (kind == KIND_EXIT) return popArgs.length == 32 && _sload(_s(5)) == 1;
        if (kind == KIND_MIGRATE) {
            if (popArgs.length != 64 || _sload(_s(3)) != 1) return false;
            (bytes memory params, bytes memory witness) = abi.decode(verifyData, (bytes, bytes));
            if (keccak256(params) != bytes32(_sload(_s(9)))) return false;
            return _schemeOk(backupScheme, params, abi.encode(RULE_MIGRATE, uint256(0), keccak256(popArgs)), witness);
        }
        if (kind == KIND_QUANTUM) return popArgs.length == 32 && _sload(_s(3)) == 0 && _ownerSigned(RULE_QUANTUM, 0, popArgs, verifyData);
        return false;
    }

    function action(bytes calldata popArgs, address) internal override {
        uint256 kind = _word(popArgs, 0);
        if (kind == KIND_SPEND) {
            (, address to, uint256 value, bytes memory data) = abi.decode(popArgs, (uint256, address, uint256, bytes));
            uint256 epoch = _sload(_s(2));
            _sstore(_s(2), epoch + 1); // first: the next spend needs a new signature whatever the call does
            (bool ok,) = to.call{value: value}(data);
            emit Spend(epoch, to, value, ok);
        } else if (kind == KIND_VOTE) {
            _countVote(bytes32(_word(popArgs, 1)), _word(popArgs, 2));
        } else if (kind == KIND_EXIT) {
            _sstore(_s(4), 1);
            address to = address(uint160(_sload(_s(8))));
            uint256 amount = address(this).balance;
            emit Exited(to, amount);
            _sendOrCredit(to, amount);
        } else if (kind == KIND_MIGRATE) {
            _sstore(_s(4), 1);
            address to = _address(popArgs, 1);
            uint256 amount = address(this).balance;
            emit Migrated(to, amount);
            _sendOrCredit(to, amount);
        } else if (kind == KIND_QUANTUM) {
            _sstore(_s(3), 1);
            emit QuantumSwitched(false);
        }
    }

    function _onQuorum(bytes32 proposal) internal override {
        if (proposal == PROPOSAL_QUANTUM) {
            _sstore(_s(3), 1);
            emit QuantumSwitched(true);
            return;
        }
        // any other proposal is a rotation: the proposal is the new owner params hash itself
        uint256 readyAt = block.timestamp + recoveryDelay;
        _sstore(_s(6), uint256(_pendingFromProposal(proposal)));
        _sstore(_s(7), readyAt);
        _sstore(_s(5), 0);
        emit RotationPending(_pendingFromProposal(proposal), readyAt);
    }

    function _pendingFromProposal(bytes32 proposal) private pure returns (bytes32) {
        return proposal;
    }

    // ------------------------------------------------------------------ signatures

    function _ownerSigned(uint256 ruleId, uint256 epoch, bytes calldata popArgs, bytes calldata verifyData) private view returns (bool) {
        if (verifyData.length < 64) return false;
        (bytes memory params, bytes memory witness) = abi.decode(verifyData, (bytes, bytes));
        if (keccak256(params) != bytes32(_sload(_s(1)))) return false;
        return _schemeOk(ownerScheme, params, abi.encode(ruleId, epoch, keccak256(popArgs)), witness);
    }

    function _schemeOk(IIntentScheme scheme, bytes memory params, bytes memory context, bytes memory witness) private view returns (bool) {
        (bool s, bytes memory ret) = address(scheme).staticcall(abi.encodeCall(IIntentScheme.checkFor, (address(this), params, context, witness)));
        return s && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
    }
}
