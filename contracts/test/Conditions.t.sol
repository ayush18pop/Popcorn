// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreHarness} from "test/CoreHarness.sol";
import {ThresholdCondition} from "src/conditions/ThresholdCondition.sol";
import {ProofCondition} from "src/conditions/ProofCondition.sol";
import {IVerifier} from "src/interfaces/IVerifier.sol";
import {ThresholdAlarm} from "src/examples/ThresholdAlarm.sol";
import {MockValue} from "src/mocks/MockValue.sol";
import {SelfThresholdRule} from "src/mocks/SelfThresholdRule.sol";

interface Vm {
    function load(address, bytes32) external view returns (bytes32);
    function warp(uint256) external;
}

contract RevertingTarget {
    function value() external pure returns (uint256) {
        revert("no");
    }
}

contract ShortTarget {
    fallback() external {
        assembly {
            mstore(0, 7)
            return(0, 16)
        }
    }
}

contract BurnerTarget {
    uint256 public n;

    function value() external view returns (uint256 v) {
        v = 1e30;
        for (uint256 i; i < type(uint256).max; i++) {
            v += n; // runs out of its 10k read gas
        }
    }
}

contract MockVerifier is IVerifier {
    uint256 public mode; // 0 honest, 1 revert, 2 return garbage (64 bytes), 3 return 2

    function setMode(uint256 m) external {
        mode = m;
    }

    function verify(bytes calldata proof, uint256[] calldata inputs) external view returns (bool) {
        if (mode == 1) revert("bad proof");
        if (mode == 2) {
            assembly {
                mstore(0, 1)
                mstore(32, 1)
                return(0, 64)
            }
        }
        if (mode == 3) {
            assembly {
                mstore(0, 2)
                return(0, 32)
            }
        }
        return inputs.length == 3 && inputs[0] == uint256(uint160(address(this))) && inputs[1] == 0xBEEF && inputs[2] == 7
            && keccak256(proof) == keccak256("good proof");
    }
}

/// inputs = [address(verifier), recipient from popArgs, 7]: the proof is bound to the recipient in popArgs.
contract ProofRule is ProofCondition {
    constructor(IVerifier v) ProofCondition(v) {}

    function _publicInputs(bytes calldata popArgs) internal view override returns (uint256[] memory inputs) {
        inputs = new uint256[](3);
        inputs[0] = uint256(uint160(address(proofVerifier)));
        inputs[1] = uint256(uint160(_address(popArgs, 0)));
        inputs[2] = 7;
    }

    function nonceKey(bytes calldata popArgs) internal pure override returns (uint256) {
        return _hashKey(popArgs);
    }

    function action(bytes calldata, address) internal override {}
}

contract TriggersTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant LINE = 1_000;

    function _alarm(address target, ThresholdCondition.Direction d) internal returns (ThresholdAlarm l, CoreHarness h) {
        l = new ThresholdAlarm(target, bytes4(keccak256("value()")), LINE, d, 0);
        h = new CoreHarness(address(l), 50_000);
    }

    // ---------------------------------------------------------------- ThresholdCondition, both sides of each boundary

    function test_threshold_above_boundaries() public {
        MockValue m = new MockValue();
        (, CoreHarness h) = _alarm(address(m), ThresholdCondition.Direction.Above);
        m.set(0);
        require(!h.condition("", ""), "0: false");
        m.set(LINE - 1);
        require(!h.condition("", ""), "line - 1: false");
        m.set(LINE);
        require(!h.condition("", ""), "line: false (strictly above)");
        m.set(LINE + 1);
        require(h.condition("", ""), "line + 1: true");
        m.set(type(uint256).max);
        require(h.condition("", ""), "max: true");
    }

    function test_threshold_below_boundaries() public {
        MockValue m = new MockValue();
        (, CoreHarness h) = _alarm(address(m), ThresholdCondition.Direction.Below);
        m.set(LINE + 1);
        require(!h.condition("", ""), "line + 1: false");
        m.set(LINE);
        require(!h.condition("", ""), "line: false (strictly below)");
        m.set(LINE - 1);
        require(h.condition("", ""), "line - 1: true");
        m.set(0);
        require(h.condition("", ""), "0: true");
    }

    function test_threshold_failClosed() public {
        (, CoreHarness h1) = _alarm(address(new RevertingTarget()), ThresholdCondition.Direction.Below);
        require(!h1.condition("", ""), "reverting target: false");
        (, CoreHarness h2) = _alarm(address(new ShortTarget()), ThresholdCondition.Direction.Below);
        require(!h2.condition("", ""), "16-byte return: false");
        (, CoreHarness h3) = _alarm(address(new BurnerTarget()), ThresholdCondition.Direction.Above);
        require(!h3.condition("", ""), "target running out of its 10k read gas: false, condition itself survives");
        (, CoreHarness h4) = _alarm(address(0xdead), ThresholdCondition.Direction.Below);
        require(!h4.condition("", ""), "no code: false");
    }

    function test_thresholdAlarm_popOnceRecordsValue() public {
        MockValue m = new MockValue();
        (ThresholdAlarm l, CoreHarness h) = _alarm(address(m), ThresholdCondition.Direction.Above);
        m.set(LINE);
        try h.pop("", "") {
            revert("not crossed: invalid");
        } catch {}
        m.set(LINE + 5);
        uint256 key = h.pop("", "");
        require(key == uint256(keccak256("popcorn.example.threshold.fire")), "constant key");
        require(h.load(l.FIRED_SLOT()) == LINE + 5, "value seen, in the rule contract");
        require(uint256(vm.load(address(l), l.FIRED_SLOT())) == 0, "not in the logic");
        try h.pop("", "") {
            revert("second trigger: key used");
        } catch {}
    }

    function test_thresholdCrossedView() public {
        (ThresholdAlarm a,) = _alarm(address(1), ThresholdCondition.Direction.Above);
        (ThresholdAlarm b,) = _alarm(address(1), ThresholdCondition.Direction.Below);
        require(!a.thresholdCrossed(LINE) && a.thresholdCrossed(LINE + 1), "above");
        require(!b.thresholdCrossed(LINE) && b.thresholdCrossed(LINE - 1), "below");
    }

    function test_proof_trueOnlyForBoundInputsAndProof() public {
        MockVerifier v = new MockVerifier();
        CoreHarness h = new CoreHarness(address(new ProofRule(v)), 100_000);
        bytes memory forMe = abi.encode(address(0xBEEF));
        require(h.condition(forMe, "good proof"), "valid");
        require(!h.condition(forMe, "bad proof"), "other proof");
        require(!h.condition(abi.encode(address(0xCAFE)), "good proof"), "same proof, other recipient: false");
        v.setMode(1);
        require(!h.condition(forMe, "good proof"), "verifier reverts: false");
        v.setMode(2);
        require(!h.condition(forMe, "good proof"), "garbage return: false");
        v.setMode(3);
        require(!h.condition(forMe, "good proof"), "returns 2: false");
        v.setMode(0);
        require(!h.condition(hex"00", "good proof"), "popArgs too short: false");
    }
}

contract SelfThresholdTest {
    function test_selfThreshold_bothSides_andFireOnce() public {
        SelfThresholdRule l = new SelfThresholdRule(1_000, ThresholdCondition.Direction.Above);
        CoreHarness h = new CoreHarness(address(l), 20_000);
        bytes memory fire = abi.encode(uint256(0), uint256(0));
        require(!h.condition(fire, ""), "0: false");
        h.pop(abi.encode(uint256(1), uint256(1_000)), "");
        require(h.load(l.VALUE_SLOT()) == 1_000 && !h.condition(fire, ""), "line: false");
        h.pop(abi.encode(uint256(1), uint256(1_001)), "");
        require(h.condition(fire, ""), "line + 1: true");
        h.pop(fire, "");
        require(h.load(l.FIRED_SLOT()) == 1_001, "fired, value recorded in the rule contract");
        try h.pop(fire, "") {
            revert("fires once");
        } catch {}
        require(!h.condition(abi.encode(uint256(2), uint256(0)), ""), "unknown cmd: false");
    }
}

/// A target/verifier that reverts, returns short/long/huge data, loops, or returns 2 never makes a condition true.
contract ModeTarget {
    uint256 public m; // 0 revert, 1 short, 2 two words (1,1), 3 returns 2, 4 40,000 bytes, 5 infinite loop, 6 returns 1

    constructor(uint256 m_) {
        m = m_;
    }

    fallback(bytes calldata) external returns (bytes memory) {
        uint256 mm = m;
        if (mm == 0) revert("x");
        if (mm == 1) return hex"01";
        if (mm == 2) return abi.encode(uint256(1), uint256(1));
        if (mm == 3) return abi.encode(uint256(2));
        if (mm == 4) {
            assembly {
                return(0, 40000)
            }
        }
        if (mm == 5) {
            while (true) {}
        }
        return abi.encode(uint256(1));
    }
}

contract ModeProofRule is ProofCondition {
    constructor(IVerifier v) ProofCondition(v) {}

    function _publicInputs(bytes calldata) internal pure override returns (uint256[] memory i) {
        i = new uint256[](1);
    }

    function nonceKey() internal pure override returns (uint256) {
        return 1;
    }

    function action() internal override {}
}

contract ModeThresholdRule is ThresholdCondition {
    constructor(address t) ThresholdCondition(t, bytes4(0x3fa4f245), 0, Direction.Above, 10_000) {}

    function nonceKey() internal pure override returns (uint256) {
        return 1;
    }

    function action() internal override {}
}

contract FailClosedTest {
    function test_proofFailClosedEveryMode() public {
        for (uint256 m = 0; m < 7; m++) {
            ModeTarget v = new ModeTarget(m);
            CoreHarness h = new CoreHarness(address(new ModeProofRule(IVerifier(address(v)))), 230_000);
            require(h.condition("", hex"00") == (m == 6), "proof condition: only an exact true word passes");
        }
    }

    function test_thresholdEveryMode() public {
        for (uint256 m = 0; m < 7; m++) {
            ModeTarget v = new ModeTarget(m);
            CoreHarness h = new CoreHarness(address(new ModeThresholdRule(address(v))), 20_000);
            // value > 0 is "crossed": only the two exact-32-byte returns 2 and 1 count
            require(h.condition("", "") == (m == 3 || m == 6), "threshold: only a 32-byte value counts");
        }
    }
}
