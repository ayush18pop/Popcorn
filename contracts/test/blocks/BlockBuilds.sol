// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Test-only builds: each plugs ONE block (or one block and its obvious partner) into the smallest possible rule contract,
// so every block is tested alone through CoreHarness (= Core's calls). Nothing here is a product.

import {RulePays} from "src/payers/RulePays.sol";
import {IVerifier} from "src/interfaces/IVerifier.sol";
import {IPausable} from "src/interfaces/IPausable.sol";
import {Answer, Join} from "src/blocks/Answer.sol";
import {ValueCrossesLine} from "src/blocks/checks/ValueCrossesLine.sol";
import {ValueMovesTooFast} from "src/blocks/checks/ValueMovesTooFast.sol";
import {ContractCodeChanged} from "src/blocks/checks/ContractCodeChanged.sol";
import {ReporterStatement} from "src/blocks/checks/ReporterStatement.sol";
import {RulesBrokenProof} from "src/blocks/checks/RulesBrokenProof.sol";
import {GroupMembership} from "src/blocks/checks/GroupMembership.sol";
import {PauseTarget} from "src/blocks/actions/PauseTarget.sol";
import {PayTheReward} from "src/blocks/actions/PayTheReward.sol";
import {MakeACall} from "src/blocks/actions/MakeACall.sol";
import {ExitToAddress} from "src/blocks/actions/ExitToAddress.sol";
import {KeyHandover} from "src/blocks/actions/KeyHandover.sol";
import {QuantumSafeSwitch} from "src/blocks/actions/QuantumSafeSwitch.sol";
import {AnonymousGroupVote} from "src/blocks/actions/AnonymousGroupVote.sol";
import {RepayLoan} from "src/blocks/actions/RepayLoan.sol";

/// Exposes the pure Join functions to tests.
contract JoinProbe {
    function allOf(uint8 a, uint8 b) external pure returns (uint8) {
        return Answer.unwrap(Join.allOf(Answer.wrap(a), Answer.wrap(b)));
    }

    function anyOf(uint8 a, uint8 b) external pure returns (uint8) {
        return Answer.unwrap(Join.anyOf(Answer.wrap(a), Answer.wrap(b)));
    }

    function noneOf(uint8 a, uint8 b) external pure returns (uint8) {
        return Answer.unwrap(Join.noneOf(Answer.wrap(a), Answer.wrap(b)));
    }

    function atLeast(uint256 k, uint8[] calldata xs) external pure returns (uint8) {
        return Answer.unwrap(Join.atLeast(k, _w(xs)));
    }

    function exactly(uint256 k, uint8[] calldata xs) external pure returns (uint8) {
        return Answer.unwrap(Join.exactly(k, _w(xs)));
    }

    function ifElse(uint8 c, uint8 t, uint8 e) external pure returns (uint8) {
        return Answer.unwrap(Join.ifElse(Answer.wrap(c), Answer.wrap(t), Answer.wrap(e)));
    }

    function allOfList(uint8[] calldata xs) external pure returns (uint8) {
        return Answer.unwrap(Join.allOf(_w(xs)));
    }

    function anyOfList(uint8[] calldata xs) external pure returns (uint8) {
        return Answer.unwrap(Join.anyOf(_w(xs)));
    }

    function _w(uint8[] calldata xs) private pure returns (Answer[] memory a) {
        a = new Answer[](xs.length);
        for (uint256 i; i < xs.length; i++) {
            a[i] = Answer.wrap(xs[i]);
        }
    }
}

/// A gauge whose value anyone sets, and which can be told to revert or burn gas.
contract Gauge {
    uint256 public value;
    uint8 public mode; // 0 normal, 1 revert, 2 burn gas, 3 short return

    function set(uint256 v) external {
        value = v;
    }

    function setMode(uint8 m) external {
        mode = m;
    }

    function read() external view returns (uint256) {
        if (mode == 1) revert("broken");
        if (mode == 2) {
            uint256 x;
            for (uint256 i; i < 100_000; i++) {
                x += i;
            }
            return x;
        }
        if (mode == 3) {
            assembly {
                return(0, 16)
            }
        }
        return value;
    }

    function pair(address) external view returns (uint256, uint256) {
        return (1, value);
    }
}

/// Fires when Gauge.read() is above LINE (word 0 of the read), or, kind 2, when pair(this) word 1 is below LINE.
contract LineBuild is ValueCrossesLine, RulePays {
    address public immutable gauge;
    uint256 public immutable line;
    bytes32 public constant FIRED = keccak256("test.line.fired");

    constructor(address g, uint256 l) {
        gauge = g;
        line = l;
    }

    function check(uint256 kind) public view returns (Answer) {
        if (kind == 2) return _getterCrossesLine(gauge, abi.encodeWithSignature("pair(address)", address(this)), 1, 20_000, line, Side.Below);
        return _getterCrossesLine(gauge, abi.encodeWithSignature("read()"), 0, 20_000, line, Side.Above);
    }

    function nonceKey(bytes calldata popArgs) internal view override returns (uint256) {
        return uint256(keccak256(abi.encode("line", _word(popArgs, 0), _sload(FIRED))));
    }

    function condition(bytes calldata popArgs, bytes calldata) internal view override returns (bool) {
        return check(_word(popArgs, 0)).isYes();
    }

    function action(bytes calldata, address) internal override {
        _sstore(FIRED, _sload(FIRED) + 1);
    }

    // pure helpers, callable on the logic itself
    function ratio(uint256 n, uint256 d, uint256 l, uint256 s, bool above) external pure returns (uint8) {
        return Answer.unwrap(_ratioCrossesLine(n, d, l, s, above ? Side.Above : Side.Below));
    }

    function band(uint256 v, uint256 lo, uint256 hi) external pure returns (uint8) {
        return Answer.unwrap(_outsideBand(v, lo, hi));
    }
}

/// Fires when Gauge.value moved more than BPS down since the remembered baseline; the action moves the baseline.
contract FastBuild is ValueMovesTooFast, RulePays {
    address public immutable gauge;
    uint256 public immutable bps;
    Move public immutable move;
    bytes32 public constant EPOCH = keccak256("test.fast.epoch");

    constructor(address g, uint256 b, Move m) {
        gauge = g;
        bps = b;
        move = m;
    }

    function setBaseline() external forwarded {
        _rememberValue(0, Gauge(gauge).value());
    }

    function baseline() external view returns (uint256) {
        return _baseline(0);
    }

    function nonceKey() internal view override returns (uint256) {
        return uint256(keccak256(abi.encode("fast", _sload(EPOCH))));
    }

    function condition() internal view override returns (bool) {
        return _movedTooFast(0, Gauge(gauge).value(), bps, move).isYes();
    }

    function action() internal override {
        _sstore(EPOCH, _sload(EPOCH) + 1);
        _rememberValue(0, Gauge(gauge).value());
    }
}

contract CodeBuild is ContractCodeChanged, RulePays {
    address public immutable watched;
    bytes32 public immutable recorded;

    constructor(address w) {
        watched = w;
        recorded = w.codehash;
    }

    function nonceKey() internal pure override returns (uint256) {
        return 1;
    }

    function condition() internal view override returns (bool) {
        return _codeChanged(watched, recorded).isYes();
    }

    function action() internal override {}
}

/// k of n reporters say STATEMENT; each statement fires once per epoch.
contract ReporterBuild is ReporterStatement, RulePays {
    address public immutable signer;
    bytes32 public immutable statement;
    uint8 public immutable k;
    address internal immutable r0;
    address internal immutable r1;
    address internal immutable r2;

    constructor(address s, bytes32 st, uint8 k_, address[] memory rs) {
        signer = s;
        statement = st;
        k = k_;
        r0 = rs[0];
        r1 = rs[1];
        r2 = rs[2];
    }

    function _reporters() internal view returns (address[] memory rs) {
        rs = new address[](3);
        rs[0] = r0;
        rs[1] = r1;
        rs[2] = r2;
    }

    function nonceKey() internal view override returns (uint256) {
        return _instructionKey(0);
    }

    function condition(bytes calldata popArgs, bytes calldata witness) internal view override returns (bool) {
        return _reportersSay(signer, statement, k, _reporters(), 0, popArgs, witness).isYes();
    }

    function action(bytes calldata, address) internal override {
        _useInstruction(0);
    }

    function epoch() external view returns (uint256) {
        return _ruleEpoch(0);
    }
}

/// A verifier that accepts a proof iff proof == abi.encode(inputs); reverts on a proof of length 1.
contract EchoVerifier is IVerifier {
    function verify(bytes calldata proof, uint256[] calldata inputs) external pure returns (bool) {
        if (proof.length == 1) revert("boom");
        return keccak256(proof) == keccak256(abi.encode(inputs));
    }
}

/// Rules-broken claims against a state word the test sets; pays nothing, records the recipient.
contract ProofBuild is RulesBrokenProof, RulePays {
    bytes32 public constant STATE = keccak256("test.proof.state");
    bytes32 public constant LAST = keccak256("test.proof.last");

    constructor(IVerifier v) RulesBrokenProof(v) {}

    function setState(uint256 s) external forwarded {
        _sstore(STATE, s);
    }

    function inputs(address recipient, uint256 claimId) external view returns (uint256[] memory) {
        return _rulesInputs(recipient, claimId);
    }

    function _rulesInputs(address recipient, uint256 claimId) internal view override returns (uint256[] memory xs) {
        xs = new uint256[](3);
        xs[0] = _sload(STATE);
        xs[1] = uint256(uint160(recipient)) | (claimId << 160);
        xs[2] = uint256(uint160(address(this)));
    }

    function nonceKey(bytes calldata popArgs) internal pure override returns (uint256) {
        return _hashKey(popArgs);
    }

    function condition(bytes calldata popArgs, bytes calldata proof) internal view override returns (bool) {
        return _rulesBroken(popArgs, proof).isYes();
    }

    function action(bytes calldata popArgs, address) internal override {
        _sstore(LAST, uint160(_claimRecipient(popArgs)));
    }

    function answerFor(bytes calldata claim, bytes calldata proof) external view returns (uint8) {
        return Answer.unwrap(_rulesBroken(claim, proof));
    }
}

contract MembershipBuild is GroupMembership, RulePays {
    constructor(IVerifier v) GroupMembership(v) {}

    function nonceKey() internal pure override returns (uint256) {
        return 1;
    }

    function condition() internal pure override returns (bool) {
        return false;
    }

    function action() internal override {}

    function inGroup(uint256 root, uint256 n, uint256 sig, uint256 scope, bytes calldata proof) external view returns (uint8) {
        return Answer.unwrap(_inGroup(root, n, sig, scope, proof));
    }
}

/// A protocol that implements IPausable for an allowed pauser (or refuses, when told to).
contract PausableProtocol is IPausable {
    bool public paused;
    bool public refuse;
    address public pauser;

    function setPauser(address p) external {
        pauser = p;
    }

    function setRefuse(bool r) external {
        refuse = r;
    }

    function pause() external {
        require(msg.sender == pauser && !refuse, "no");
        paused = true;
    }
}

/// kind 1: pause itself while FLAG is set; kind 2: pause OTHER. `reopen()` is open to anyone here (a real build guards it).
contract PauseBuild is PauseTarget, RulePays {
    bytes32 public constant FLAG = keccak256("test.pause.flag");
    bytes32 public constant SAFE = keccak256("test.pause.safe");
    address public immutable other;

    constructor(address o) {
        other = o;
    }

    function setFlag(uint256 f) external forwarded {
        _sstore(FLAG, f);
    }

    function setSafe(uint256 s) external forwarded {
        _sstore(SAFE, s);
    }

    function reopen() external forwarded {
        _reopen();
    }

    function guarded() external view whenNotPaused returns (uint256) {
        return 42;
    }

    function _safeToReopen() internal view override returns (bool) {
        return _sload(SAFE) == 1;
    }

    function nonceKey(bytes calldata popArgs) internal view override returns (uint256) {
        return _pauseKey(bytes32(_word(popArgs, 0)));
    }

    function condition(bytes calldata popArgs, bytes calldata) internal view override returns (bool) {
        if (_word(popArgs, 0) == 2) return true;
        return !_isPaused() && _sload(FLAG) == 1;
    }

    function action(bytes calldata popArgs, address) internal override {
        if (_word(popArgs, 0) == 2) {
            _pauseOther(IPausable(other));
            _pauseSelf(); // moves the epoch so the key changes
        } else {
            _pauseSelf();
        }
    }
}

/// Pays min(WANT, pool) to the address in the trigger data (the copyable kind of reward: tests only).
contract RewardBuild is PayTheReward, RulePays {
    uint256 public immutable want;
    bytes32 public constant N = keccak256("test.reward.n");

    constructor(address token, uint256 w) PayTheReward(token) {
        want = w;
    }

    function nonceKey() internal view override returns (uint256) {
        return uint256(keccak256(abi.encode("reward", _sload(N))));
    }

    function condition() internal pure override returns (bool) {
        return true;
    }

    function action(bytes calldata popArgs, address) internal override {
        _sstore(N, _sload(N) + 1);
        _payFromPool(_address(popArgs, 0), want);
    }
}

/// Calls the (to, value, data) in the trigger data.
contract CallBuild is MakeACall, RulePays {
    bytes32 public constant N = keccak256("test.call.n");

    function nonceKey() internal view override returns (uint256) {
        return uint256(keccak256(abi.encode("call", _sload(N))));
    }

    function condition() internal pure override returns (bool) {
        return true;
    }

    function action(bytes calldata popArgs, address) internal override {
        _sstore(N, _sload(N) + 1);
        (address to, uint256 value, bytes memory data) = abi.decode(popArgs, (address, uint256, bytes));
        _makeCall(to, value, data, 200_000);
    }

    receive() external payable {}
}

/// kind 1: forced exit (to the committed address); kind 2: migrate to the address in word 1.
contract ExitBuild is ExitToAddress, RulePays {
    function commit(address to) external forwarded {
        _commitExitAddress(to);
    }

    function exitInfo() external view returns (address, bool) {
        return (_exitAddress(), _exited());
    }

    function nonceKey(bytes calldata popArgs) internal pure override returns (uint256) {
        return _word(popArgs, 0);
    }

    function condition(bytes calldata, bytes calldata) internal view override returns (bool) {
        return !_exited();
    }

    function action(bytes calldata popArgs, address) internal override {
        if (_word(popArgs, 0) == 1) _exit();
        else _exitTo(_address(popArgs, 1));
    }

    receive() external payable {}
}

/// The handover's three steps as forwarded calls (a real build checks signatures and votes first).
contract HandoverBuild is KeyHandover, QuantumSafeSwitch, RulePays {
    constructor(uint256 delay) KeyHandover(delay) {}

    function setKey(bytes32 k) external forwarded {
        _setKey(k);
    }

    function propose(bytes32 k) external forwarded {
        _proposeHandover(k);
    }

    function contest() external forwarded {
        _contestHandover();
    }

    function finalize() external forwarded {
        _finalizeHandover();
    }

    function commitBackup(bytes32 k) external forwarded {
        _commitBackupKey(k);
    }

    function flip() external forwarded {
        _switchToQuantumSafe(false);
    }

    function info() external view returns (bytes32 key, bytes32 pending, uint256 readyAt, bool contested, bool qs, bytes32 backup) {
        return (_currentKey(), _pendingKey(), _handoverReadyAt(), _contested(), _quantumSafeOnly(), _backupKeyHash());
    }

    function nonceKey() internal pure override returns (uint256) {
        return 1;
    }

    function condition() internal pure override returns (bool) {
        return false;
    }

    function action() internal override {}
}

/// Votes: popArgs = (proposal, nullifierHash), verifyData = the proof. Quorum records the proposal.
contract VoteBuild is AnonymousGroupVote, RulePays {
    bytes32 public constant DONE = keccak256("test.vote.done");

    constructor(IVerifier v) AnonymousGroupVote(v) {}

    function setGroup(uint256 root, uint256 k) external forwarded {
        _setGroup(root, k);
    }

    function round() external view returns (uint256) {
        return _voteRound();
    }

    function votes(uint256 r, bytes32 p) external view returns (uint256) {
        return _votesFor(r, p);
    }

    function signalOf(bytes32 p, uint256 r) external pure returns (uint256) {
        return _voteSignal(p, r);
    }

    function scopeOf(uint256 r) external view returns (uint256) {
        return _voteScope(r);
    }

    function nonceKey(bytes calldata popArgs) internal pure override returns (uint256) {
        return _word(popArgs, 1);
    }

    function condition(bytes calldata popArgs, bytes calldata proof) internal view override returns (bool) {
        if (popArgs.length != 64) return false;
        return _voteValid(bytes32(_word(popArgs, 0)), _word(popArgs, 1), proof).isYes();
    }

    function action(bytes calldata popArgs, address) internal override {
        _countVote(bytes32(_word(popArgs, 0)), _word(popArgs, 1));
    }

    function _onQuorum(bytes32 proposal) internal override {
        _sstore(DONE, uint256(proposal));
    }
}

/// A pool that records repayments, or refuses them when told to.
contract RepayPool {
    uint256 public repaid;
    bool public refuse;
    address public token;

    constructor(address t) {
        token = t;
    }

    function setRefuse(bool r) external {
        refuse = r;
    }

    function repayFor(address, uint256 amount) external {
        require(!refuse, "refused");
        (bool ok,) = token.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount));
        require(ok, "pull");
        repaid += amount;
    }
}

contract RepayBuild is RepayLoan, RulePays {
    address public immutable pool;
    address public immutable token;
    bytes32 public constant LAST = keccak256("test.repay.last");
    bytes32 public constant N = keccak256("test.repay.n");

    constructor(address p, address t) {
        pool = p;
        token = t;
    }

    function nonceKey() internal view override returns (uint256) {
        return uint256(keccak256(abi.encode("repay", _sload(N))));
    }

    function condition() internal pure override returns (bool) {
        return true;
    }

    function action(bytes calldata popArgs, address) internal override {
        _sstore(N, _sload(N) + 1);
        _sstore(LAST, uint256(_repayLoan(pool, token, address(0xB0B), _word(popArgs, 0))));
    }
}
