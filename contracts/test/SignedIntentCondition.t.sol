// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreHarness} from "test/CoreHarness.sol";
import {SignedIntentCounter} from "src/examples/SignedIntentCounter.sol";
import {EcdsaSigner} from "src/signers/EcdsaSigner.sol";
import {IntentDigest} from "src/signers/IntentDigest.sol";

interface Vm {
    function sign(uint256 pk, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
    function addr(uint256 pk) external pure returns (address);
}

/// SignedIntentCondition through CoreHarness (a plain contract that calls a logic the way Core does): replay, rule, rule contract and
/// argument binding, with a real ECDSA predicate and the params blob.
contract SignedIntentTriggerTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant PK = 0xA11CE;
    uint256 constant PK_OTHER = 0xB0B;

    EcdsaSigner pred;
    SignedIntentCounter logic;
    CoreHarness k1;
    CoreHarness k2;

    function setUp() public {
        pred = new EcdsaSigner();
        bytes memory params = abi.encodePacked(vm.addr(PK));
        bytes memory init = abi.encodePacked(hex"61", uint16(params.length), hex"80600c6000396000f3", params);
        address blob;
        assembly {
            blob := create(0, add(init, 0x20), mload(init))
        }
        require(blob != address(0) && blob.code.length == params.length, "blob");
        logic = new SignedIntentCounter(address(pred), blob);
        k1 = new CoreHarness(address(logic), 200_000);
        k2 = new CoreHarness(address(logic), 200_000);
    }

    function _args(uint256 rule, uint256 amount) internal pure returns (bytes memory) {
        return abi.encode(rule, amount);
    }

    function _sig(uint256 pk, address ruleContract, uint256 rule, uint256 epoch, bytes memory args) internal view returns (bytes memory) {
        bytes32 d = IntentDigest.intentDigest(ruleContract, rule, epoch, keccak256(args));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function _total(CoreHarness k, uint256 rule) internal view returns (uint256) {
        return k.load(keccak256(abi.encode(keccak256("popcorn.example.signedIntentCounter.total"), rule)));
    }

    function _epoch(CoreHarness k, uint256 rule) internal view returns (uint256) {
        return k.load(keccak256(abi.encode(keccak256("popcorn.signedIntent.epoch"), rule)));
    }

    function _tryPop(CoreHarness k, bytes memory args, bytes memory w) internal returns (bool ok) {
        (ok,) = address(k).call(abi.encodeCall(CoreHarness.pop, (args, w)));
    }

    function test_validPopRunsOnceAndAdvancesTheEpoch() public {
        bytes memory a = _args(0, 5);
        bytes memory w = _sig(PK, address(k1), 0, 0, a);
        require(k1.condition(a, w), "condition true");
        k1.pop(a, w);
        require(_total(k1, 0) == 5, "action ran");
        require(_epoch(k1, 0) == 1, "epoch bumped");
    }

    function test_replayOfTheSameSignedIntentIsRefused() public {
        bytes memory a = _args(0, 5);
        bytes memory w = _sig(PK, address(k1), 0, 0, a);
        k1.pop(a, w);
        require(!k1.condition(a, w), "condition false: the rule contract now asks for epoch 1");
        require(!_tryPop(k1, a, w), "second trigger refused");
        require(_total(k1, 0) == 5, "ran once");
    }

    function test_nextEpochNeedsItsOwnSignature() public {
        bytes memory a = _args(0, 5);
        k1.pop(a, _sig(PK, address(k1), 0, 0, a));
        require(!_tryPop(k1, a, _sig(PK, address(k1), 0, 0, a)), "epoch 0 signature");
        require(!_tryPop(k1, a, _sig(PK, address(k1), 0, 2, a)), "a future epoch's signature");
        k1.pop(a, _sig(PK, address(k1), 0, 1, a));
        require(_total(k1, 0) == 10 && _epoch(k1, 0) == 2, "second intent ran");
    }

    function test_signatureForRuleAcannotPopRuleB() public {
        bytes memory a0 = _args(0, 5);
        bytes memory w0 = _sig(PK, address(k1), 0, 0, a0);
        bytes memory a1 = _args(1, 5); // same amount, rule 1
        require(!_tryPop(k1, a1, w0), "rule 0 signature, rule 1 popArgs");
        require(_total(k1, 1) == 0, "rule 1 untouched");
        k1.pop(a1, _sig(PK, address(k1), 1, 0, a1)); // rule 1 has its own epoch, still 0
        require(_total(k1, 1) == 5 && _epoch(k1, 1) == 1 && _epoch(k1, 0) == 0, "rules advance separately");
        k1.pop(a0, w0); // the rule 0 signature still works for rule 0
        require(_total(k1, 0) == 5, "rule 0 ran");
    }

    function test_signatureForRuleContract1cannotPopRuleContract2() public {
        bytes memory a = _args(0, 5);
        bytes memory w1 = _sig(PK, address(k1), 0, 0, a);
        require(!_tryPop(k2, a, w1), "k1 signature on k2");
        require(_total(k2, 0) == 0, "k2 untouched");
        k2.pop(a, _sig(PK, address(k2), 0, 0, a));
        k1.pop(a, w1);
        require(_total(k1, 0) == 5 && _total(k2, 0) == 5, "each rule contract ran once");
    }

    function test_popperCannotChangeTheSignedArguments() public {
        bytes memory w = _sig(PK, address(k1), 0, 0, _args(0, 5));
        require(!_tryPop(k1, _args(0, 6), w), "amount changed");
        require(!_tryPop(k1, _args(0, 5), _sig(PK_OTHER, address(k1), 0, 0, _args(0, 5))), "another signer");
        require(!_tryPop(k1, _args(0, 5), ""), "no signature");
        require(!_tryPop(k1, _args(0, 5), hex"00"), "garbage");
    }

    function test_unknownRuleIsRefused() public {
        bytes memory a = _args(2, 5);
        require(!_tryPop(k1, a, _sig(PK, address(k1), 2, 0, a)), "rule 2 does not exist");
        (bool ok,) = address(k1).call(abi.encodeCall(CoreHarness.nonceKey, (a)));
        require(ok, "harness call itself succeeds");
        (bool kOk,) = k1.nonceKey(a);
        require(!kOk, "nonceKey reverts for an unknown rule");
    }

    function test_malformedWitnessIsFalseNotARevert() public {
        bytes memory a = _args(0, 5);
        require(!k1.condition(a, ""), "empty");
        require(!k1.condition(a, new bytes(65)), "zeros");
        require(!k1.condition(a, new bytes(5000)), "big junk");
    }

    function test_nonceKeysAreDistinctPerRuleAndEpoch() public {
        (, uint256 a0) = k1.nonceKey(_args(0, 1));
        (, uint256 a1) = k1.nonceKey(_args(1, 1));
        (, uint256 a0again) = k1.nonceKey(_args(0, 999));
        require(a0 != a1, "rules differ");
        require(a0 == a0again, "the key does not depend on the amount (popArgs): one trigger per epoch");
        k1.pop(_args(0, 5), _sig(PK, address(k1), 0, 0, _args(0, 5)));
        (, uint256 b0) = k1.nonceKey(_args(0, 1));
        require(b0 != a0, "epoch moved the key");
    }
}
