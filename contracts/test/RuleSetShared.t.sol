// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleSetLogic} from "src/rules/RuleSetLogic.sol";
import {RuleSetPublisher} from "src/rules/RuleSetPublisher.sol";
import {RuleSetPointer} from "src/rules/RuleSetPointer.sol";
import {RuleSet} from "src/rules/RuleSet.sol";
import "src/rules/RuleSetCodec.sol";
import {RuleSetBase} from "test/RuleSet.t.sol";

interface Vm2 {
    function etch(address, bytes calldata) external;
}

/// A stand-in rule contract: forwards everything to `logic` by DELEGATECALL (like Core's forward path). The test appends Core's 101
/// args to its code (vm.etch) so the shared logic reads a real `verifier` field from `address(this).code`.
contract MiniRule {
    address immutable logic;

    constructor(address l) {
        logic = l;
    }

    fallback() external payable {
        address l = logic;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), l, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }
}

contract RuleSetSharedTest is RuleSetBase {
    RuleSetPublisher internal pub = new RuleSetPublisher();
    RuleSetLogic internal logic = new RuleSetLogic(address(pub), 0);

    /// 101 Core args with `verifier` at bytes [69, 89): logic | mode | fees | gas | state | verifier | conditionGas | caps
    function _args(address verifier) internal view returns (bytes memory) {
        return abi.encodePacked(address(logic), uint8(0), uint128(1), uint128(1), uint64(200_000), uint64(195_840), verifier, uint32(50_000), uint32(0), uint32(128));
    }

    function _ruleContract(bytes memory cfg) internal returns (MiniRule k, address ptr) {
        ptr = pub.publish(cfg);
        k = new MiniRule(address(logic));
        bytes memory code = address(k).code;
        Vm2(address(vm)).etch(address(k), bytes.concat(code, _args(ptr)));
    }

    function test_publish_validates_is_idempotent_and_deterministic() public {
        bytes memory cfg = one(cmpV(OP_GT, 5));
        address predicted = pub.predict(cfg);
        address p1 = pub.publish(cfg);
        require(p1 == predicted && p1.code.length == cfg.length, "pointer holds the config as code");
        require(keccak256(p1.code) == keccak256(cfg), "code == config");
        require(pub.publish(cfg) == p1, "idempotent");
        // an invalid config is refused (nothing deployed)
        bytes memory bad = one(RuleSetCodec.kofn(3, k2(T(), T())));
        bool reverted;
        try pub.publish(bad) {} catch {
            reverted = true;
        }
        require(reverted, "publisher validates");
        require(pub.predict(bad).code.length == 0, "nothing deployed");
        // oversize node count
        bytes[] memory kids = new bytes[](16);
        for (uint256 i; i < 16; ++i) kids[i] = T();
        bytes[] memory top = new bytes[](5);
        for (uint256 i; i < 5; ++i) top[i] = RuleSetCodec.and_(kids);
        reverted = false;
        try pub.publish(one(RuleSetCodec.and_(top))) {} catch {
            reverted = true;
        }
        require(reverted, "85 nodes refused at publication");
    }

    function test_shared_logic_reads_the_ruleContracts_own_verifier_arg() public {
        g.setValue(10);
        (MiniRule k1_, address p1) = _ruleContract(one(cmpV(OP_GT, 5)));
        (MiniRule k2_, address p2) = _ruleContract(one(cmpV(OP_GT, 50)));
        require(p1 != p2, "two configs, two pointers");
        // the SAME logic gives each rule contract its own rule set
        (bool ok, bytes memory ret) = address(k1_).call(abi.encodeCall(RuleSetLogic.ruleSetConfig, ()));
        require(ok && keccak256(abi.decode(ret, (bytes))) == keccak256(p1.code), "rule contract 1 config");
        (ok, ret) = address(k2_).call(abi.encodeCall(RuleSetLogic.ruleSetConfig, ()));
        require(ok && keccak256(abi.decode(ret, (bytes))) == keccak256(p2.code), "rule contract 2 config");
        RuleSet.RuleDebug memory d1 = _dbg(address(k1_), 0);
        RuleSet.RuleDebug memory d2 = _dbg(address(k2_), 0);
        require(d1.wouldPass && !d2.wouldPass, "10 > 5 passes, 10 > 50 does not");
    }

    function test_pointer_not_made_by_the_publisher_is_refused() public {
        bytes memory cfg = one(T());
        // a valid-looking pointer deployed by someone else (plain CREATE of the same loader + config)
        bytes memory init = RuleSetPointer.initcode(cfg);
        address rogue;
        assembly {
            rogue := create(0, add(init, 32), mload(init))
        }
        MiniRule k = new MiniRule(address(logic));
        Vm2(address(vm)).etch(address(k), bytes.concat(address(k).code, _args(rogue)));
        (bool ok,) = address(k).call(abi.encodeCall(RuleSet.popcornDebug, (0, abi.encode(uint256(0)), "")));
        require(!ok, "a pointer the publisher did not create reverts (BadPointer)");
        // and one whose code was never a config
        MiniRule k2_ = new MiniRule(address(logic));
        Vm2(address(vm)).etch(address(k2_), bytes.concat(address(k2_).code, _args(address(g))));
        (ok,) = address(k2_).call(abi.encodeCall(RuleSet.popcornDebug, (0, abi.encode(uint256(0)), "")));
        require(!ok, "an arbitrary contract as verifier reverts");
        // no args at all (not a rule contract): NotARule contract
        (ok,) = address(logic).call(abi.encodeCall(RuleSet.popcornDebug, (0, abi.encode(uint256(0)), "")));
        require(!ok, "direct call reverts");
    }

    function _dbg(address k, uint256 ruleId) internal returns (RuleSet.RuleDebug memory d) {
        (bool ok, bytes memory ret) = k.call(abi.encodeCall(RuleSet.popcornDebug, (ruleId, abi.encode(ruleId), "")));
        require(ok, "debug");
        d = abi.decode(ret, (RuleSet.RuleDebug));
    }
}
