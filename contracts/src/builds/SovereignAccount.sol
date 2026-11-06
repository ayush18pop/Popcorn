// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "src/interfaces/IVerifier.sol";
import {IIntentScheme} from "src/signers/IIntentScheme.sol";
import {Answer, YES, NO} from "src/blocks/Answer.sol";
import {SignedInstruction} from "src/blocks/checks/SignedInstruction.sol";
import {MakeACall} from "src/blocks/actions/MakeACall.sol";
import {AnonymousGroupVote} from "src/blocks/actions/AnonymousGroupVote.sol";
import {KeyHandover} from "src/blocks/actions/KeyHandover.sol";
import {QuantumSafeSwitch} from "src/blocks/actions/QuantumSafeSwitch.sol";
import {ExitToAddress} from "src/blocks/actions/ExitToAddress.sol";
import {Flow, IPopcornExplain, FLOW_YES, FLOW_NO, FLOW_SKIPPED} from "src/rules/Explain.sol";
import {answer} from "src/blocks/Answer.sol";

/// @title Sovereign Account (example build, the flagship)
/// @notice A wallet account that keeps working when the things around it fail: a broken key scheme, a guardian takeover,
///         a missing gas balance. It is the account itself that pays (Core mode 0) and stakes, so anyone may send its
///         transactions from a key with no ETH. Built from blocks:
///
///           check    Signed Instruction, Anyone Can Send   the owner signs each spend; the key type is the owner scheme
///                                                          (ECDSA + Falcon-512 in the flagship: Both Keys Must Sign)
///           action   Make A Call                           the spend itself
///           action   Anonymous Group Vote                  guardians, unnamed, decide by k of n private votes
///           action   Hand Over To A New Key                a guardian quorum proposes a new owner key; it waits a delay;
///                                                          the owner can contest it
///           action   Switch To Quantum-Safe Only           flipped by the owner or by the guardians; then owner spends stop
///           action   Exit To An Address                    forced exit (to the address committed on day one) once a
///                                                          handover is contested; migrate (to an address the backup key
///                                                          signs) once the account is quantum-safe only
///           payer    Contract Pays The Gas                 the account pays its own gas (Core mode 0)
///
///         Wiring, the only logic this file adds: quorum on PROPOSAL_QUANTUM flips the switch, quorum on anything else
///         proposes that key hash as the new owner; "contested" from Hand Over opens the forced exit; "quantum-safe only"
///         from the switch closes owner spends and opens migration.
///
///         Triggers (trigger data word 0 = kind):
///           1 SPEND    abi.encode(1, to, value, data)          verify data = abi.encode(ownerParams, witness)
///           2 VOTE     abi.encode(2, proposal, nullifierHash)  verify data = the membership proof
///           3 EXIT     abi.encode(3)                           verify data empty
///           4 MIGRATE  abi.encode(4, target)                   verify data = abi.encode(backupParams, witness)
///           5 QUANTUM  abi.encode(5)                           verify data = abi.encode(ownerParams, witness)
///         Ordinary calls: initialize (once, by the deployer), finalizeRecovery (anyone, after the delay), contest (the
///         owner's signature), deposit (anyone; plain ETH works too).
///
///         Validation reads only this account's storage and calls the signer and verifier contracts (code, no storage),
///         so the account stakes for the alternative mempool, whose 2,500,000 staked budget covers Falcon (~1.5M).
contract SovereignAccount is SignedInstruction, MakeACall, AnonymousGroupVote, KeyHandover, QuantumSafeSwitch, ExitToAddress, IPopcornExplain {
    /// @dev slot 0: initialized flag (the rest of the state lives in the blocks' own namespaces).
    bytes32 private constant SLOT = keccak256("popcorn.build.sovereignAccount");

    uint256 public constant KIND_SPEND = 1;
    uint256 public constant KIND_VOTE = 2;
    uint256 public constant KIND_EXIT = 3;
    uint256 public constant KIND_MIGRATE = 4;
    uint256 public constant KIND_QUANTUM = 5;
    /// @notice Signed Instruction kinds (IntentDigest ruleId) for the owner's and the backup key's signatures.
    uint256 public constant RULE_SPEND = 1;
    uint256 public constant RULE_QUANTUM = 5;
    uint256 public constant RULE_CONTEST = 6;
    uint256 public constant RULE_MIGRATE = 4;
    bytes32 public constant PROPOSAL_QUANTUM = keccak256(abi.encode("quantum"));
    bytes32 internal constant KEY_EXIT = keccak256("popcorn.sovereign.exit");
    bytes32 internal constant KEY_MIGRATE = keccak256("popcorn.sovereign.migrate");
    bytes32 internal constant KEY_QUANTUM = keccak256("popcorn.sovereign.quantum");

    IIntentScheme public immutable ownerScheme;
    IIntentScheme public immutable backupScheme;
    address public immutable deployer;
    address internal immutable stakeRegistry;
    uint256 internal immutable stakeAmount;
    uint32 internal immutable stakeDelay;

    event Initialized(bytes32 ownerParamsHash, address exitAddress, bytes32 backupParamsHash, uint256 guardiansRoot, uint256 threshold);
    event Spend(uint256 indexed epoch, address indexed to, uint256 value, bool success);
    event Migrated(address indexed to, uint256 amount);

    error AlreadyInitialized();
    error NotDeployer();
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
    ) AnonymousGroupVote(membershipVerifier_) KeyHandover(recoveryDelay_) {
        ownerScheme = ownerScheme_;
        backupScheme = backupScheme_;
        deployer = deployer_;
        stakeRegistry = stakeRegistry_;
        stakeAmount = stakeAmount_;
        stakeDelay = stakeDelay_;
    }

    function _stakeConfig() internal view override returns (address, uint256, uint32) {
        return (stakeRegistry, stakeAmount, stakeDelay);
    }

    // ------------------------------------------------------------------ ordinary calls

    /// @notice One-time setup by the deployer: owner key hash, exit address, backup key hash, guardians.
    function initialize(bytes32 ownerParamsHash, address exitAddress, bytes32 backupParamsHash, uint256 guardiansRoot_, uint256 threshold)
        external
        forwarded
    {
        if (msg.sender != deployer) revert NotDeployer();
        if (_sload(SLOT) != 0) revert AlreadyInitialized();
        _sstore(SLOT, 1);
        _setKey(ownerParamsHash);
        _commitExitAddress(exitAddress);
        _commitBackupKey(backupParamsHash);
        _setGroup(guardiansRoot_, threshold);
        emit Initialized(ownerParamsHash, exitAddress, backupParamsHash, guardiansRoot_, threshold);
    }

    function deposit() external payable forwarded {}

    /// @notice After the delay, anyone completes an uncontested handover to the guardians' new owner key.
    function finalizeRecovery() external forwarded {
        _finalizeHandover();
    }

    /// @notice The current owner contests a pending handover by signing (kind RULE_CONTEST, epoch = the guardians' vote
    ///         round): the handover is dropped and the account is contested, which opens the forced exit to anyone.
    function contest(bytes calldata ownerParams, bytes calldata witness) external forwarded {
        bytes memory context = abi.encode(RULE_CONTEST, _voteRound(), keccak256("contest"));
        if (keccak256(ownerParams) != _currentKey() || !_signerSays(address(ownerScheme), ownerParams, context, witness).isYes()) {
            revert BadSignature();
        }
        _contestHandover();
    }

    function recoveryDelay() external view returns (uint256) {
        return handoverDelay;
    }

    function guardiansRoot() external view returns (uint256) {
        return _groupRoot();
    }

    function guardianThreshold() external view returns (uint256) {
        return _voteThreshold();
    }

    function guardianRound() external view returns (uint256) {
        return _voteRound();
    }

    function guardianVotes(uint256 round, bytes32 proposal) external view returns (uint256) {
        return _votesFor(round, proposal);
    }

    function state()
        external
        view
        forwarded
        returns (bytes32 ownerParamsHash, uint256 spendEpoch, bool quantum, bool exited, bool contested, bytes32 pendingOwner, uint256 pendingReadyAt, address exitAddress)
    {
        return (
            _currentKey(),
            _ruleEpoch(RULE_SPEND),
            _quantumSafeOnly(),
            _exited(),
            _contested(),
            _pendingKey(),
            _handoverReadyAt(),
            _exitAddress()
        );
    }

    // ------------------------------------------------------------------ triggers: which block answers which kind

    function nonceKey(bytes calldata popArgs) internal view override returns (uint256) {
        uint256 kind = _word(popArgs, 0);
        if (kind == KIND_SPEND) return _instructionKey(RULE_SPEND);
        if (kind == KIND_VOTE) return _word(popArgs, 2); // the nullifier hash: one vote per guardian per round
        if (kind == KIND_EXIT) return uint256(KEY_EXIT);
        if (kind == KIND_MIGRATE) return uint256(KEY_MIGRATE);
        if (kind == KIND_QUANTUM) return uint256(KEY_QUANTUM);
        return 0; // Core refuses a zero key
    }

    function condition(bytes calldata popArgs, bytes calldata verifyData) internal view override returns (bool) {
        if (_sload(SLOT) != 1 || _exited()) return false; // not set up, or the funds already left
        return _check(popArgs, verifyData).isYes();
    }

    function _check(bytes calldata popArgs, bytes calldata verifyData) internal view returns (Answer) {
        uint256 kind = _word(popArgs, 0);
        if (kind == KIND_SPEND) {
            if (_quantumSafeOnly()) return NO; // after the switch, owner signatures stop working
            // the action decodes these; a malformed spend reverts here (invalid trigger) instead of there (key spent)
            abi.decode(popArgs, (uint256, address, uint256, bytes));
            return _ownerSigned(RULE_SPEND, popArgs, verifyData);
        }
        if (kind == KIND_VOTE) {
            if (popArgs.length != 96) return NO;
            return _voteValid(bytes32(_word(popArgs, 1)), _word(popArgs, 2), verifyData);
        }
        if (kind == KIND_EXIT) return popArgs.length == 32 && _contested() ? YES : NO;
        if (kind == KIND_MIGRATE) {
            if (popArgs.length != 64 || !_quantumSafeOnly()) return NO;
            _address(popArgs, 1); // reverts on a dirty address word, as the action would
            return _keySigned(backupScheme, _backupKeyHash(), RULE_MIGRATE, popArgs, verifyData);
        }
        if (kind == KIND_QUANTUM) {
            if (popArgs.length != 32 || _quantumSafeOnly()) return NO;
            return _ownerSigned(RULE_QUANTUM, popArgs, verifyData);
        }
        return NO;
    }

    function action(bytes calldata popArgs, address) internal override {
        uint256 kind = _word(popArgs, 0);
        if (kind == KIND_SPEND) {
            uint256 epoch = _ruleEpoch(RULE_SPEND);
            _useInstruction(RULE_SPEND); // first: the next spend needs a new signature whatever the call does
            (, address to, uint256 value, bytes memory data) = abi.decode(popArgs, (uint256, address, uint256, bytes));
            emit Spend(epoch, to, value, _makeCall(to, value, data));
        } else if (kind == KIND_VOTE) {
            _countVote(bytes32(_word(popArgs, 1)), _word(popArgs, 2));
        } else if (kind == KIND_EXIT) {
            _exit();
        } else if (kind == KIND_MIGRATE) {
            address to = _address(popArgs, 1);
            emit Migrated(to, address(this).balance);
            _exitTo(to);
        } else if (kind == KIND_QUANTUM) {
            _switchToQuantumSafe(false);
        }
    }

    /// @notice Anonymous Group Vote reached its quorum: flip the switch, or propose the new owner key.
    function _onQuorum(bytes32 proposal) internal override {
        if (proposal == PROPOSAL_QUANTUM) _switchToQuantumSafe(true);
        else _proposeHandover(proposal);
    }

    // ------------------------------------------------------------------ signatures (Signed Instruction with a hashed key)

    function _ownerSigned(uint256 kind, bytes calldata popArgs, bytes calldata verifyData) private view returns (Answer) {
        return _keySigned(ownerScheme, _currentKey(), kind, popArgs, verifyData);
    }

    /// @dev verify data = abi.encode(params, witness); the params must hash to the committed key.
    function _keySigned(IIntentScheme scheme, bytes32 keyHash, uint256 kind, bytes calldata popArgs, bytes calldata verifyData)
        private
        view
        returns (Answer)
    {
        if (verifyData.length < 64) return NO;
        (bytes memory params, bytes memory witness) = abi.decode(verifyData, (bytes, bytes));
        if (keccak256(params) != keyHash) return NO;
        return _signerSays(address(scheme), params, _intentContext(kind, _ruleEpoch(kind), popArgs), witness);
    }

    // ------------------------------------------------------------------ explain (the explorer's flow, same order as condition)

    // node 0 trigger, 1 payer, 2 the account guard, then each kind's blocks (format: IPopcornExplain)
    string private constant HEAD = "p|self-paying|the account pays its own gas|0;c||the account is set up and has not exited|0;";

    function popcornExplain(bytes calldata popArgs, bytes calldata verifyData) external view returns (string memory, string memory, bytes memory) {
        uint256 kind = popArgs.length >= 32 ? uint256(bytes32(popArgs[0:32])) : 0;
        bool active = _sload(SLOT) == 1 && !_exited();
        uint8 a = Flow.result(answer(active));
        if (kind == KIND_SPEND || kind == KIND_MIGRATE || kind == KIND_QUANTUM) {
            bool gate = kind == KIND_SPEND ? !_quantumSafeOnly() : kind == KIND_MIGRATE ? popArgs.length == 64 && _quantumSafeOnly() : popArgs.length == 32 && !_quantumSafeOnly();
            if (kind == KIND_SPEND && active && gate) abi.decode(popArgs, (uint256, address, uint256, bytes)); // as the condition
            Answer sig = !(active && gate)
                ? NO
                : kind == KIND_MIGRATE ? _keySigned(backupScheme, _backupKeyHash(), RULE_MIGRATE, popArgs, verifyData) : _ownerSigned(kind == KIND_SPEND ? RULE_SPEND : RULE_QUANTUM, popArgs, verifyData);
            bytes memory r = abi.encodePacked(FLOW_YES, FLOW_YES, a, Flow.after_(active, answer(gate)), Flow.after_(active && gate, sig), active && gate ? Flow.result(sig) : FLOW_NO, Flow.runs(active && gate && sig.isYes()));
            if (kind == KIND_SPEND) {
                return ("spend", string.concat("t||Spend: (to, value, data) signed by the owner, anyone can send it|;", HEAD, "c|post-quantum-mode|Post-Quantum Mode is off|0;c|signature|the owner key signed this exact spend|0;o|and|AND|2,3,4;a|call|make the call with the value|5"), r);
            }
            if (kind == KIND_MIGRATE) {
                return ("migrate", string.concat("t||Migrate: a target address signed by the backup key|;", HEAD, "c|post-quantum-mode|Post-Quantum Mode is on|0;c|signature|the committed post-quantum backup key signed this target|0;o|and|AND|2,3,4;a|withdraw-all|send everything to the signed target, once|5"), r);
            }
            return ("quantum", string.concat("t||Post-Quantum Mode: signed by the owner|;", HEAD, "c|post-quantum-mode|Post-Quantum Mode is still off|0;c|signature|the owner key signed it|0;o|and|AND|2,3,4;a|post-quantum-mode|turn on Post-Quantum Mode: owner keys stop working|5"), r);
        }
        if (kind == KIND_VOTE) {
            bool shaped = popArgs.length == 96;
            bytes32 proposal = shaped ? bytes32(popArgs[32:64]) : bytes32(0);
            Answer vote = active && shaped ? _voteValid(proposal, uint256(bytes32(popArgs[64:96])), verifyData) : NO;
            bool go = active && vote.isYes();
            bool quorum = go && _votesFor(_voteRound(), proposal) + 1 >= _voteThreshold();
            return (
                "vote",
                string.concat(
                    "t||Vote: a proposal and a guardian's nullifier, with a membership proof|;", HEAD,
                    "c|membership-proof|a guardian's valid vote for this round (who is not revealed)|0;o|and|AND|2,3;a|anonymous-vote|count the vote|4;c|anonymous-vote|this vote reaches the quorum|5;",
                    proposal == PROPOSAL_QUANTUM ? "a|post-quantum-mode|turn on Post-Quantum Mode|6" : "a|key-rotation|propose this key as the new owner, after the timelock|6"
                ),
                abi.encodePacked(FLOW_YES, FLOW_YES, a, Flow.after_(active, vote), active ? Flow.result(vote) : FLOW_NO, Flow.runs(go), go ? Flow.result(answer(quorum)) : FLOW_SKIPPED, Flow.runs(quorum))
            );
        }
        if (kind == KIND_EXIT) {
            Answer c = answer(popArgs.length == 32 && _contested());
            return (
                "exit",
                string.concat("t||Exit: no data, anyone can send it|;", HEAD, "c|key-rotation|an owner contested a key rotation|0;o|and|AND|2,3;a|withdraw-all|send everything to the exit address committed on day one|4"),
                abi.encodePacked(FLOW_YES, FLOW_YES, a, Flow.after_(active, c), active ? Flow.result(c) : FLOW_NO, Flow.runs(active && c.isYes()))
            );
        }
        return ("unknown", "t||trigger kind is not 1 to 5|", abi.encodePacked(FLOW_NO));
    }
}
