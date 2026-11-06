// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreHarness} from "test/CoreHarness.sol";
import "test/blocks/BlockBuilds.sol";
import {DemoToken} from "src/mocks/DemoToken.sol";
import {AttestedFactSigner} from "src/signers/AttestedFactSigner.sol";
import {IntentDigest} from "src/signers/IntentDigest.sol";
import {ValueMovesTooFast} from "src/blocks/checks/ValueMovesTooFast.sol";
import {PauseTarget} from "src/blocks/actions/PauseTarget.sol";
import {KeyHandover} from "src/blocks/actions/KeyHandover.sol";
import {ExitToAddress} from "src/blocks/actions/ExitToAddress.sol";
import {QuantumSafeSwitch} from "src/blocks/actions/QuantumSafeSwitch.sol";
import {PayTheReward} from "src/blocks/actions/PayTheReward.sol";
import {RepayLoan} from "src/blocks/actions/RepayLoan.sol";

interface Vm {
    function etch(address, bytes calldata) external;
    function warp(uint256) external;
    function sign(uint256 pk, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
    function addr(uint256 pk) external pure returns (address);
    function deal(address, uint256) external;
}

contract RefuseEth {
    receive() external payable {
        revert("no");
    }
}

abstract contract BlockTestBase {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint8 constant N = 0;
    uint8 constant Y = 1;
    uint8 constant U = 2;

    /// Core's error code when the harness refuses a trigger, 0xff when it was admitted.
    function _code(CoreHarness h, bytes memory popArgs, bytes memory verifyData) internal returns (uint8 code) {
        try h.pop(popArgs, verifyData) {
            return 0xff;
        } catch (bytes memory err) {
            require(bytes4(err) == CoreHarness.InvalidPop.selector, "InvalidPop");
            assembly {
                code := mload(add(err, 36))
            }
        }
    }

    function _u8s(uint8 a, uint8 b, uint8 c) internal pure returns (uint8[] memory xs) {
        xs = new uint8[](3);
        xs[0] = a;
        xs[1] = b;
        xs[2] = c;
    }
}

// ================================================================== joins: All Of, Any Of, None Of, At Least k, Exactly k, If / Else

contract JoinTest is BlockTestBase {
    JoinProbe j = new JoinProbe();

    /// Every pair of answers against the definition (no beats unknown in All Of, yes beats unknown in Any Of, None Of keeps
    /// unknown unknown).
    function test_pairs_exhaustive() public view {
        for (uint8 a; a < 3; a++) {
            for (uint8 b; b < 3; b++) {
                uint8 all = (a == N || b == N) ? N : (a == U || b == U) ? U : Y;
                uint8 any = (a == Y || b == Y) ? Y : (a == U || b == U) ? U : N;
                uint8 none = any == Y ? N : any == N ? Y : U;
                require(j.allOf(a, b) == all, "allOf");
                require(j.anyOf(a, b) == any, "anyOf");
                require(j.noneOf(a, b) == none, "noneOf");
                uint8[] memory xs = new uint8[](2);
                xs[0] = a;
                xs[1] = b;
                require(j.allOfList(xs) == all && j.anyOfList(xs) == any, "list forms agree");
            }
        }
    }

    /// All 27 triples, every k from 0 to 4: At Least k and Exactly k against a brute force over the unknowns.
    function test_counting_exhaustive() public view {
        for (uint8 a; a < 3; a++) {
            for (uint8 b; b < 3; b++) {
                for (uint8 c; c < 3; c++) {
                    uint8[] memory xs = _u8s(a, b, c);
                    for (uint256 k; k <= 4; k++) {
                        (bool canYesL, bool canNoL, bool canYesE, bool canNoE) = _bruteForce(xs, k);
                        require(j.atLeast(k, xs) == _tri(canYesL, canNoL), "atLeast");
                        require(j.exactly(k, xs) == _tri(canYesE, canNoE), "exactly");
                    }
                }
            }
        }
    }

    /// Resolve each unknown both ways: the answer is yes (or no) only if every resolution agrees.
    function _bruteForce(uint8[] memory xs, uint256 k) internal pure returns (bool yesL, bool noL, bool yesE, bool noE) {
        uint256 unknowns;
        for (uint256 i; i < 3; i++) {
            if (xs[i] == U) unknowns++;
        }
        bool allL = true;
        bool noneL = true;
        bool allE = true;
        bool noneE = true;
        for (uint256 m; m < (1 << unknowns); m++) {
            uint256 yes;
            uint256 bit;
            for (uint256 i; i < 3; i++) {
                if (xs[i] == Y) yes++;
                else if (xs[i] == U) {
                    if ((m >> bit) & 1 == 1) yes++;
                    bit++;
                }
            }
            if (yes >= k) noneL = false;
            else allL = false;
            if (yes == k) noneE = false;
            else allE = false;
        }
        return (allL, noneL, allE, noneE);
    }

    function _tri(bool alwaysYes, bool alwaysNo) internal pure returns (uint8) {
        return alwaysYes ? Y : alwaysNo ? N : U;
    }

    function test_ifElse() public view {
        for (uint8 t; t < 3; t++) {
            for (uint8 e; e < 3; e++) {
                require(j.ifElse(Y, t, e) == t && j.ifElse(N, t, e) == e && j.ifElse(U, t, e) == U, "ifElse");
            }
        }
    }

    function test_exactlyOne_isExactlyK1() public view {
        require(j.exactly(1, _u8s(Y, N, N)) == Y, "one yes");
        require(j.exactly(1, _u8s(Y, Y, N)) == N, "two yes");
        require(j.exactly(1, _u8s(Y, U, N)) == U, "unknown could be a second yes");
        require(j.exactly(1, _u8s(N, N, N)) == N, "none");
    }
}

// ================================================================== checks

contract ValueCrossesLineTest is BlockTestBase {
    Gauge g;
    LineBuild logic;
    CoreHarness h;

    function setUp() public {
        g = new Gauge();
        logic = new LineBuild(address(g), 100);
        h = new CoreHarness(address(logic), 60_000);
    }

    function test_getter_above_fires_once_per_epoch() public {
        g.set(100);
        require(_code(h, abi.encode(uint256(1)), "") == 0x22, "at the line: no");
        g.set(101);
        require(Answer.unwrap(LineBuild(payable(address(h))).check(1)) == Y, "above: yes");
        h.pop(abi.encode(uint256(1)), "");
        require(h.load(logic.FIRED()) == 1, "fired");
    }

    function test_broken_reads_are_unknown_never_yes() public {
        g.set(1_000);
        LineBuild b = LineBuild(payable(address(h)));
        g.setMode(1);
        require(Answer.unwrap(b.check(1)) == U, "revert: unknown");
        g.setMode(2);
        require(Answer.unwrap(b.check(1)) == U, "out of its gas cap: unknown");
        g.setMode(3);
        require(Answer.unwrap(b.check(1)) == U, "short return: unknown");
        require(_code(h, abi.encode(uint256(1)), "") == 0x22, "unknown never fires");
    }

    function test_getter_with_argument_and_word_index_below() public {
        g.set(50);
        require(Answer.unwrap(LineBuild(payable(address(h))).check(2)) == Y, "word 1 of pair(this) = 50 < 100");
        g.set(100);
        require(Answer.unwrap(LineBuild(payable(address(h))).check(2)) == N, "not below");
    }

    function test_ratio_and_band() public view {
        // share price floor 1.0: 999 assets / 1,000 shares is below; 1,000 / 1,000 is not
        require(logic.ratio(999e18, 1_000e18, 1e18, 1e18, false) == Y, "999/1000 < 1.0");
        require(logic.ratio(1_000e18, 1_000e18, 1e18, 1e18, false) == N, "1.0 is not below 1.0");
        require(logic.ratio(type(uint256).max, 1, type(uint256).max, 1, true) == N, "no overflow at the extremes");
        require(logic.ratio(type(uint256).max, 1, type(uint256).max - 1, 1, true) == Y, "512-bit compare");
        require(logic.band(99, 100, 200) == Y && logic.band(201, 100, 200) == Y && logic.band(150, 100, 200) == N, "band");
    }
}

contract ValueMovesTooFastTest is BlockTestBase {
    function test_down_move_over_bps_fires_and_moves_baseline() public {
        Gauge g = new Gauge();
        FastBuild logic = new FastBuild(address(g), 2_000, ValueMovesTooFast.Move.Down); // 20%
        CoreHarness h = new CoreHarness(address(logic), 60_000);
        FastBuild b = FastBuild(payable(address(h)));
        g.set(1_000);
        require(_code(h, "", "") == 0x22, "no baseline yet: no");
        b.setBaseline();
        g.set(800);
        require(_code(h, "", "") == 0x22, "exactly 20%: not more than");
        g.set(799);
        h.pop("", "");
        require(b.baseline() == 799, "baseline moved to the value it fired at");
        g.set(700);
        require(_code(h, "", "") == 0x22, "measured from 799 now: 12%");
        g.set(5_000);
        require(_code(h, "", "") == 0x22, "an up move is not a down move");
    }

    function test_either_direction() public {
        Gauge g = new Gauge();
        FastBuild logic = new FastBuild(address(g), 1_000, ValueMovesTooFast.Move.Either);
        CoreHarness h = new CoreHarness(address(logic), 60_000);
        g.set(100);
        FastBuild(payable(address(h))).setBaseline();
        g.set(111);
        h.pop("", "");
        g.set(99);
        h.pop("", ""); // 111 -> 99 is 10.8% down
    }
}

contract ContractCodeChangedTest is BlockTestBase {
    function test_fires_when_code_changes() public {
        Gauge g = new Gauge();
        CodeBuild logic = new CodeBuild(address(g));
        CoreHarness h = new CoreHarness(address(logic), 30_000);
        require(_code(h, "", "") == 0x22, "same code: no");
        vm.etch(address(g), address(new JoinProbe()).code);
        h.pop("", "");
    }
}

contract ReporterStatementTest is BlockTestBase {
    uint256 constant PK0 = 0xA11CE;
    uint256 constant PK1 = 0xB0B;
    uint256 constant PK2 = 0xCA7;
    bytes32 constant ST = keccak256("ETH/USD below 1800");

    function test_two_of_three_reporters_once_per_epoch() public {
        address[] memory rs = new address[](3);
        rs[0] = vm.addr(PK0);
        rs[1] = vm.addr(PK1);
        rs[2] = vm.addr(PK2);
        ReporterBuild logic = new ReporterBuild(address(new AttestedFactSigner()), ST, 2, rs);
        CoreHarness h = new CoreHarness(address(logic), 80_000);
        bytes memory popArgs = abi.encode(uint256(7));
        bytes32 d = IntentDigest.attestationDigest(address(h), ST, 0, 0, keccak256(popArgs));
        bytes memory one = _sig(0, PK0, d);
        require(_code(h, popArgs, one) == 0x22, "one reporter is not two");
        require(_code(h, popArgs, abi.encodePacked(one, _sig(1, PK2, d))) == 0x22, "wrong key for index 1");
        bytes memory two = abi.encodePacked(one, _sig(2, PK2, d));
        require(_code(h, abi.encode(uint256(8)), two) == 0x22, "signed for other trigger data");
        h.pop(popArgs, two);
        require(ReporterBuild(payable(address(h))).epoch() == 1, "epoch moved");
        require(_code(h, popArgs, two) == 0x22, "replay after the epoch moved");
    }

    function _sig(uint8 idx, uint256 pk, bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(idx, r, s, v);
    }
}

contract RulesBrokenProofTest is BlockTestBase {
    function test_proof_binds_recipient_and_claim() public {
        ProofBuild logic = new ProofBuild(new EchoVerifier());
        CoreHarness h = new CoreHarness(address(logic), 100_000);
        ProofBuild b = ProofBuild(payable(address(h)));
        b.setState(1234);
        address whitehat = address(0xBEEF);
        bytes memory claim = abi.encode(whitehat, uint256(1));
        bytes memory proof = abi.encode(b.inputs(whitehat, 1));
        require(_code(h, abi.encode(address(0xC0FFEE), uint256(1)), proof) == 0x22, "copier's recipient: no");
        require(_code(h, abi.encode(whitehat, uint256(2)), proof) == 0x22, "other claim id: no");
        b.setState(1235);
        require(_code(h, claim, proof) == 0x22, "state moved on: the proof is stale");
        b.setState(1234);
        require(b.answerFor(claim, hex"00") == U, "a reverting verifier is unknown");
        require(b.answerFor(abi.encode(whitehat, uint256(1) << 64), proof) == N, "claim id over 64 bits: no");
        h.pop(claim, proof);
        require(h.load(logic.LAST()) == uint160(whitehat), "paid the bound recipient");
    }

    function test_no_verifier_is_off() public {
        ProofBuild logic = new ProofBuild(IVerifier(address(0)));
        CoreHarness h = new CoreHarness(address(logic), 100_000);
        require(_code(h, abi.encode(address(1), uint256(1)), "") == 0x22, "off");
    }
}

contract GroupMembershipTest is BlockTestBase {
    function test_in_group_answers() public {
        MembershipBuild logic = new MembershipBuild(new EchoVerifier());
        CoreHarness h = new CoreHarness(address(logic), 100_000);
        MembershipBuild b = MembershipBuild(payable(address(h)));
        uint256[] memory ins = new uint256[](4);
        (ins[0], ins[1], ins[2], ins[3]) = (11, 22, 33, 44);
        bytes memory proof = abi.encode(ins);
        require(b.inGroup(11, 22, 33, 44, proof) == Y, "member");
        require(b.inGroup(11, 22, 34, 44, proof) == N, "other signal");
        require(b.inGroup(0, 22, 33, 44, proof) == N, "no group");
        require(b.inGroup(11, 22, 33, 44, hex"00") == U, "verifier reverts: unknown");
    }
}

// ================================================================== actions

contract PauseTargetTest is BlockTestBase {
    PausableProtocol other;
    PauseBuild logic;
    CoreHarness h;
    PauseBuild b;

    function setUp() public {
        other = new PausableProtocol();
        logic = new PauseBuild(address(other));
        h = new CoreHarness(address(logic), 60_000);
        b = PauseBuild(payable(address(h)));
        other.setPauser(address(h));
    }

    function test_pause_self_epoch_and_guard() public {
        require(b.guarded() == 42, "open");
        b.setFlag(1);
        h.pop(abi.encode(uint256(1)), "");
        require(b.paused() && b.pauseEpoch() == 1, "paused, epoch 1");
        (bool ok,) = address(h).call(abi.encodeCall(PauseBuild.guarded, ()));
        require(!ok, "guarded function refuses while paused");
        require(_code(h, abi.encode(uint256(1)), "") == 0x22, "already paused: no second trigger");
    }

    function test_reopen_only_when_safe() public {
        b.setFlag(1);
        h.pop(abi.encode(uint256(1)), "");
        (bool ok, bytes memory err) = address(h).call(abi.encodeCall(PauseBuild.reopen, ()));
        require(!ok && bytes4(err) == PauseTarget.NotSafeToReopen.selector, "not safe");
        b.setSafe(1);
        b.reopen();
        require(!b.paused() && b.pauseEpoch() == 1, "reopened, epoch kept");
        (ok, err) = address(h).call(abi.encodeCall(PauseBuild.reopen, ()));
        require(!ok && bytes4(err) == PauseTarget.TargetNotPaused.selector, "not paused");
        h.pop(abi.encode(uint256(1)), ""); // new epoch, new key
        require(b.pauseEpoch() == 2, "epoch 2");
    }

    function test_pause_other_best_effort() public {
        h.pop(abi.encode(uint256(2)), "");
        require(other.paused(), "outside target paused");
        PausableProtocol stubborn = new PausableProtocol();
        stubborn.setRefuse(true);
        PauseBuild l2 = new PauseBuild(address(stubborn));
        CoreHarness h2 = new CoreHarness(address(l2), 60_000);
        h2.pop(abi.encode(uint256(2)), ""); // the refusal does not revert the action
        require(!stubborn.paused() && PauseBuild(payable(address(h2))).pauseEpoch() == 1, "action ran to the end");
    }
}

contract PayTheRewardTest is BlockTestBase {
    function test_token_pool_pays_min_and_survives_refusal() public {
        DemoToken t = new DemoToken("T", "T");
        RewardBuild logic = new RewardBuild(address(t), 10e18);
        CoreHarness h = new CoreHarness(address(logic), 30_000);
        RewardBuild b = RewardBuild(payable(address(h)));
        t.mint(address(this), 100e18);
        t.approve(address(h), type(uint256).max);
        b.fundRewards(15e18);
        require(b.rewardPool() == 15e18, "funded");
        h.pop(abi.encode(address(0xA0A0)), "");
        require(t.balanceOf(address(0xA0A0)) == 10e18 && b.rewardPool() == 5e18, "paid the full reward");
        h.pop(abi.encode(address(0xB0B0)), "");
        require(t.balanceOf(address(0xB0B0)) == 5e18 && b.rewardPool() == 0, "paid what was left");
        h.pop(abi.encode(address(0xC0C0)), "");
        require(t.balanceOf(address(0xC0C0)) == 0, "empty pool pays nothing, action does not revert");
        b.fundRewards(1e18);
        h.pop(abi.encode(address(h)), "");
        require(b.rewardPool() == 1e18, "never pays the build itself");
    }

    function test_eth_pool_refused_payment_stays_in_pool() public {
        RewardBuild logic = new RewardBuild(address(0), 1 ether);
        CoreHarness h = new CoreHarness(address(logic), 30_000);
        RewardBuild b = RewardBuild(payable(address(h)));
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(h).call{value: 1}(abi.encodeCall(PayTheReward.fundRewards, (2 ether)));
        require(!ok, "value must equal the amount");
        b.fundRewards{value: 2 ether}(2 ether);
        address refuser = address(new RefuseEth());
        h.pop(abi.encode(refuser), "");
        require(b.rewardPool() == 2 ether && refuser.balance == 0, "refused: kept in the pool");
        h.pop(abi.encode(address(0xD0D0)), "");
        require(address(0xD0D0).balance == 1 ether && b.rewardPool() == 1 ether, "paid in ETH");
    }
}

contract MakeACallTest is BlockTestBase {
    function test_call_success_and_failure_never_revert() public {
        CallBuild logic = new CallBuild();
        CoreHarness h = new CoreHarness(address(logic), 30_000);
        Gauge g = new Gauge();
        h.pop(abi.encode(address(g), uint256(0), abi.encodeCall(Gauge.set, (77))), "");
        require(g.value() == 77, "called");
        h.pop(abi.encode(address(new RefuseEth()), uint256(0), hex"12345678"), ""); // reverts inside, action survives
        require(h.load(logic.N()) == 2, "both triggers ran their action");
    }
}

contract ExitToAddressTest is BlockTestBase {
    function test_forced_exit_once_to_committed_address() public {
        ExitBuild logic = new ExitBuild();
        CoreHarness h = new CoreHarness(address(logic), 30_000);
        ExitBuild b = ExitBuild(payable(address(h)));
        b.commit(address(0xE0E0));
        (bool ok, bytes memory err) = address(h).call(abi.encodeCall(ExitBuild.commit, (address(0xF0F0))));
        require(!ok && bytes4(err) == ExitToAddress.ExitAddressAlreadyCommitted.selector, "committed once");
        vm.deal(address(h), 3 ether);
        h.pop(abi.encode(uint256(1)), "");
        (address to, bool exited) = b.exitInfo();
        require(to == address(0xE0E0) && exited && address(0xE0E0).balance == 3 ether, "everything left, once");
        require(_code(h, abi.encode(uint256(2), address(0xF0F0)), "") == 0x22, "after the exit nothing else");
    }

    function test_migrate_to_refusing_receiver_is_credited() public {
        ExitBuild logic = new ExitBuild();
        CoreHarness h = new CoreHarness(address(logic), 30_000);
        address refuser = address(new RefuseEth());
        vm.deal(address(h), 1 ether);
        h.pop(abi.encode(uint256(2), refuser), "");
        require(ExitBuild(payable(address(h))).owed(refuser) == 1 ether, "credited, claimable");
    }
}

contract KeyHandoverTest is BlockTestBase {
    function test_propose_wait_finalize() public {
        HandoverBuild logic = new HandoverBuild(1 days);
        CoreHarness h = new CoreHarness(address(logic), 30_000);
        HandoverBuild b = HandoverBuild(payable(address(h)));
        b.setKey(bytes32("old"));
        vm.warp(1_000);
        b.propose(bytes32("new"));
        (bool ok, bytes memory err) = address(h).call(abi.encodeCall(HandoverBuild.finalize, ()));
        require(!ok && bytes4(err) == KeyHandover.HandoverTooEarly.selector, "too early");
        vm.warp(1_000 + 1 days);
        b.finalize();
        (bytes32 key, bytes32 pending,, bool contested,,) = b.info();
        require(key == bytes32("new") && pending == 0 && !contested, "handed over");
    }

    function test_contest_blocks_and_new_proposal_clears() public {
        HandoverBuild logic = new HandoverBuild(1 days);
        CoreHarness h = new CoreHarness(address(logic), 30_000);
        HandoverBuild b = HandoverBuild(payable(address(h)));
        b.setKey(bytes32("old"));
        (bool ok, bytes memory err) = address(h).call(abi.encodeCall(HandoverBuild.contest, ()));
        require(!ok && bytes4(err) == KeyHandover.NoPendingHandover.selector, "nothing to contest");
        b.propose(bytes32("thief"));
        b.contest();
        (bytes32 key, bytes32 pending,, bool contested,,) = b.info();
        require(key == bytes32("old") && pending == 0 && contested, "contested, key kept");
        vm.warp(block.timestamp + 2 days);
        (ok, err) = address(h).call(abi.encodeCall(HandoverBuild.finalize, ()));
        require(!ok && bytes4(err) == KeyHandover.NoPendingHandover.selector, "nothing to finalize");
        b.propose(bytes32("next"));
        (,,, contested,,) = b.info();
        require(!contested, "a new proposal clears the contest");
    }

    function test_quantum_switch_and_backup_commit() public {
        HandoverBuild logic = new HandoverBuild(0);
        CoreHarness h = new CoreHarness(address(logic), 30_000);
        HandoverBuild b = HandoverBuild(payable(address(h)));
        b.commitBackup(bytes32("pq"));
        (bool ok, bytes memory err) = address(h).call(abi.encodeCall(HandoverBuild.commitBackup, (bytes32("other"))));
        require(!ok && bytes4(err) == QuantumSafeSwitch.BackupKeyAlreadyCommitted.selector, "committed once");
        (,,,, bool qs, bytes32 backup) = b.info();
        require(!qs && backup == bytes32("pq"), "off, backup committed");
        b.flip();
        (,,,, qs,) = b.info();
        require(qs, "switched");
    }
}

contract AnonymousGroupVoteTest is BlockTestBase {
    function _proof(VoteBuild b, bytes32 p, uint256 nh) internal view returns (bytes memory) {
        uint256 r = b.round();
        uint256[] memory ins = new uint256[](4);
        (ins[0], ins[1], ins[2], ins[3]) = (999, nh, b.signalOf(p, r), b.scopeOf(r));
        return abi.encode(ins);
    }

    function test_two_of_n_quorum_then_next_round() public {
        VoteBuild logic = new VoteBuild(new EchoVerifier());
        CoreHarness h = new CoreHarness(address(logic), 100_000);
        VoteBuild b = VoteBuild(payable(address(h)));
        bytes32 p = keccak256("rotate");
        require(_code(h, abi.encode(p, uint256(1)), _proof(b, p, 1)) == 0x22, "no group yet");
        b.setGroup(999, 2);
        h.pop(abi.encode(p, uint256(1)), _proof(b, p, 1));
        require(b.votes(0, p) == 1, "one vote");
        require(_code(h, abi.encode(p, uint256(1)), _proof(b, p, 1)) == 0x1f, "same member again: the nullifier key is used");
        bytes32 other = keccak256("other");
        require(_code(h, abi.encode(other, uint256(2)), _proof(b, p, 2)) == 0x22, "a proof for one proposal cannot vote another");
        h.pop(abi.encode(p, uint256(2)), _proof(b, p, 2));
        require(h.load(logic.DONE()) == uint256(p) && b.round() == 1, "quorum ran, next round");
        // a vote proved for round 0 is dead in round 1
        uint256[] memory ins = new uint256[](4);
        (ins[0], ins[1], ins[2], ins[3]) = (999, 3, b.signalOf(p, 0), b.scopeOf(0));
        require(_code(h, abi.encode(p, uint256(3)), abi.encode(ins)) == 0x22, "stale round");
    }
}

contract RepayLoanTest is BlockTestBase {
    function test_repays_or_reports_never_reverts() public {
        DemoToken t = new DemoToken("D", "D");
        RepayPool pool = new RepayPool(address(t));
        RepayBuild logic = new RepayBuild(address(pool), address(t));
        CoreHarness h = new CoreHarness(address(logic), 30_000);
        t.mint(address(h), 100e18);
        h.pop(abi.encode(uint256(40e18)), "");
        require(pool.repaid() == 40e18 && h.load(logic.LAST()) == uint256(RepayLoan.RepayFailure.None), "repaid");
        pool.setRefuse(true);
        h.pop(abi.encode(uint256(10e18)), "");
        require(h.load(logic.LAST()) == uint256(RepayLoan.RepayFailure.RepayFailed), "refused, reported");
        require(t.allowance(address(h), address(pool)) == 0, "allowance cleared");
    }
}
