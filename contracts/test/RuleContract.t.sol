// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreHarness} from "test/CoreHarness.sol";
import {RuleContract} from "src/rules/RuleContract.sol";
import {RulePays} from "src/payers/RulePays.sol";
import {CallerPays} from "src/payers/CallerPays.sol";
import {RuleCosts} from "src/rules/RuleCosts.sol";

interface Vm {
    function load(address, bytes32) external view returns (bytes32);
    function deal(address, uint256) external;
    function snapshotState() external returns (uint256);
    function revertToState(uint256) external returns (bool);
}

/// _hashKey as the library computes it (domain-separated).
function hashKey(bytes memory popArgs) pure returns (uint256) {
    return uint256(keccak256(abi.encodePacked(keccak256("popcorn.kernel.popArgsKey"), popArgs)));
}

/// Counter rule contract: key = keccak(popArgs), condition = popArgs[0] != 0, action: counter += word 1 of popArgs (or 1),
/// records _payer() and, if popArgs word 2 == 1, re-enters its rule contract with pop(bytes) calldata.
contract CounterRule is RuleContract, RulePays {
    bytes32 public constant COUNTER = keccak256("test.counter");
    bytes32 public constant PAYER = keccak256("test.payer");
    bytes32 public constant REENTRY = keccak256("test.reentry"); // 1 = inner ok, 2 = inner reverted with 0x37

    function nonceKey(bytes calldata popArgs) internal pure override returns (uint256) {
        return _hashKey(popArgs);
    }

    function condition(bytes calldata popArgs, bytes calldata) internal pure override returns (bool) {
        return popArgs.length > 0 && popArgs[0] != 0;
    }

    function action(bytes calldata popArgs, address payer_) internal override {
        _sstore(COUNTER, _sload(COUNTER) + 1);
        _sstore(PAYER, uint256(uint160(_payer())));
        require(payer_ == _payer(), "payer arg == _payer()");
        if (popArgs.length >= 96 && _word(popArgs, 2) == 1) {
            (bool ok, bytes memory ret) = address(this).call(abi.encodeWithSelector(0xd9292504, bytes(hex"01")));
            _sstore(REENTRY, ok ? 1 : (ret.length == 32 && abi.decode(ret, (uint256)) == 0x37 ? 2 : 3));
        }
    }
}

contract ZeroKeyRule is RuleContract {
    function nonceKey() internal pure override returns (uint256) {
        return 0;
    }

    function condition() internal pure override returns (bool) {
        return true;
    }

    function action() internal override {}
}

contract NoHooksRule is RuleContract {}

contract HelperRule is RuleContract {
    function nonceKey(bytes calldata popArgs) internal pure override returns (uint256) {
        return _word(popArgs, 0);
    }

    function condition(bytes calldata popArgs, bytes calldata verifyData) internal pure override returns (bool) {
        return _address(popArgs, 1) == address(0xBEEF) && keccak256(verifyData) == keccak256("proof");
    }

    function action() internal override {}
}

contract StubRewardRule is RuleContract, CallerPays {
    function nonceKey() internal pure override returns (uint256) {
        return 1;
    }

    function condition() internal pure override returns (bool) {
        return true;
    }

    function action() internal override {
        _payReward(address(0), 1);
    }
}

contract MockRegistry {
    mapping(address => uint256) public stakeOf;
    mapping(address => uint32) public delayOf;
    bool public fail;

    function setFail(bool f) external {
        fail = f;
    }

    function addStake(uint32 d) external payable {
        require(!fail, "registry down");
        stakeOf[msg.sender] += msg.value;
        delayOf[msg.sender] = d;
    }

    function getDepositInfo(address a) external view returns (uint256, uint32, uint64) {
        return (stakeOf[a], delayOf[a], 0);
    }
}

contract StakingRule is CounterRule {
    address public immutable registry;
    uint256 public immutable amount;

    constructor(address r, uint256 a) {
        registry = r;
        amount = a;
    }

    function _stakeConfig() internal view override returns (address, uint256, uint32) {
        return (registry, amount, 86_400);
    }
}

contract RuleContractTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes4 constant DIRECT_CALL = 0xdf146856; // DirectCall()

    function _revertSel(bytes memory ret) internal pure returns (bytes4 s) {
        if (ret.length >= 4) s = bytes4(ret);
    }

    // ---------------------------------------------------------------- delegatecall guard

    function test_directCallsRevert() public {
        CounterRule l = new CounterRule();
        (bool a, bytes memory ra) = address(l).call(abi.encodeCall(l.__nonceKey, (hex"01")));
        (bool b, bytes memory rb) = address(l).call(abi.encodeCall(l.__condition, (hex"01", "")));
        (bool c, bytes memory rc) = address(l).call(abi.encodeCall(l.__action, (hex"01", address(this))));
        require(!a && !b && !c, "direct calls must revert");
        require(_revertSel(ra) == DIRECT_CALL && _revertSel(rb) == DIRECT_CALL && _revertSel(rc) == DIRECT_CALL, "DirectCall()");
        require(bytes4(keccak256("DirectCall()")) == DIRECT_CALL, "selector");
    }

    function test_selectorsMatchCoreABI() public pure {
        require(RuleContract.__nonceKey.selector == 0x97031c8c, "__nonceKey");
        require(RuleContract.__condition.selector == 0x05f661f0, "__condition");
        require(RuleContract.__action.selector == 0x6019566d, "__action");
    }

    function test_actionThroughHarnessRuns_storageInHarnessNotLogic() public {
        CounterRule l = new CounterRule();
        CoreHarness h = new CoreHarness(address(l), 50_000);
        h.action(hex"01");
        h.action(hex"02");
        require(h.load(l.COUNTER()) == 2, "counter in the harness (rule contract)");
        require(uint256(vm.load(address(l), l.COUNTER())) == 0, "logic storage untouched");
        require(h.load(l.PAYER()) == uint256(uint160(address(h))), "payer = the rule contract (rule-pays)");
    }

    function test_fullPop_keyOnce() public {
        CounterRule l = new CounterRule();
        CoreHarness h = new CoreHarness(address(l), 50_000);
        uint256 k = h.pop(hex"01", "");
        require(k == hashKey(hex"01") && h.usedKey(k), "key consumed");
        try h.pop(hex"01", "") {
            revert("second trigger with the same key must fail");
        } catch (bytes memory r) {
            require(keccak256(r) == keccak256(abi.encodeWithSelector(CoreHarness.InvalidPop.selector, uint8(0x1f))), "0x1f");
        }
        try h.pop(hex"00", "") {
            revert("false condition must fail");
        } catch (bytes memory r) {
            require(keccak256(r) == keccak256(abi.encodeWithSelector(CoreHarness.InvalidPop.selector, uint8(0x22))), "0x22");
        }
        require(h.load(l.COUNTER()) == 1, "action ran once");
    }

    function test_conditionAndKeyThroughHarness() public {
        CounterRule l = new CounterRule();
        CoreHarness h = new CoreHarness(address(l), 50_000);
        require(h.condition(hex"01", ""), "true");
        require(!h.condition(hex"00", ""), "false");
        require(!h.condition("", ""), "empty");
        (bool ok, uint256 key) = h.nonceKey(hex"abcd");
        require(ok && key == hashKey(hex"abcd"), "key");
    }

    function test_reentryRefusedByLock() public {
        CounterRule l = new CounterRule();
        CoreHarness h = new CoreHarness(address(l), 50_000);
        h.action(abi.encode(uint256(1), uint256(0), uint256(1)));
        require(h.load(l.COUNTER()) == 1, "action ran once");
        require(h.load(l.REENTRY()) == 2, "inner pop(bytes) reverted with 0x37");
        h.action(hex"01"); // lock released after a trigger
        require(h.load(l.COUNTER()) == 2, "next action runs");
    }

    function test_payerClearedAfterAction() public {
        CounterRule l = new CounterRule();
        CoreHarness h = new CoreHarness(address(l), 50_000);
        h.action(hex"01");
        h.action(hex"01"); // a second action in the same tx sees the payer set again, not a stale one
        require(h.load(l.PAYER()) == uint256(uint160(address(h))), "payer");
    }

    function test_zeroKeyRejected() public {
        ZeroKeyRule l = new ZeroKeyRule();
        CoreHarness h = new CoreHarness(address(l), 50_000);
        (bool ok,) = h.nonceKey("");
        require(!ok, "__nonceKey reverts ZeroNonceKey");
        (bool s, bytes memory r) = address(h).call(abi.encodeCall(CoreHarness.pop, ("", "")));
        require(!s && keccak256(r) == keccak256(abi.encodeWithSelector(CoreHarness.InvalidPop.selector, uint8(0x1b))), "0x1b");
    }

    function test_missingHooksRevertNotImplemented() public {
        NoHooksRule l = new NoHooksRule();
        CoreHarness h = new CoreHarness(address(l), 50_000);
        (bool ok,) = h.nonceKey("");
        require(!ok, "nonceKey not implemented");
        require(!h.condition("", ""), "condition not implemented = invalid");
        try h.action("") {
            revert("action must revert");
        } catch (bytes memory r) {
            require(bytes4(r) == RuleContract.NotImplemented.selector, "NotImplemented");
        }
    }

    function test_popArgsHelpers() public {
        HelperRule l = new HelperRule();
        CoreHarness h = new CoreHarness(address(l), 50_000);
        bytes memory pa = abi.encode(uint256(42), address(0xBEEF));
        (bool ok, uint256 key) = h.nonceKey(pa);
        require(ok && key == 42, "_word");
        require(h.condition(pa, "proof"), "_address + verifyData");
        require(!h.condition(pa, "proof!"), "verifyData differs");
        require(!h.condition(abi.encode(uint256(42), address(0xBEEE)), "proof"), "address differs");
        require(!h.condition(abi.encode(uint256(42)), "proof"), "too short: revert = invalid");
        require(!h.condition(abi.encode(uint256(42), uint256(1) << 160), "proof"), "dirty address: invalid");
    }

    // ---------------------------------------------------------------- payment

    function test_rulePaysViews() public {
        CounterRule l = new CounterRule();
        require(l.popcornMode() == 0, "mode 0");
        // 12,950 + 64 * (256 + 68 + 64 + 35) + 2 * 300,000 + 200,000 = 840,022 gas
        require(RuleCosts.maxGasPerPop(300_000, 200_000, 256, 64) == 840_022, "gas");
        require(l.popcornMaxCostPerPop(3 gwei, 300_000, 200_000, 256, 64) == 840_022 * 3 gwei, "cost");
        require(l.popcornMinOperatingBalance(3 gwei, 300_000, 200_000, 256, 64, 10) == 10 * 840_022 * 3 gwei, "10 triggers");
        require(l.popcornMinOperatingBalance(3 gwei, 300_000, 200_000, 256, 64, 0) == 840_022 * 3 gwei, "at least one");
    }

    /// A CallerPays logic run as rule-pays (payer == the rule contract) refuses to pay the rule contract itself.
    function test_callerPaysUnderRuleContractPays_refusesToPayItself() public {
        StubRewardRule l = new StubRewardRule();
        require(l.popcornMode() == 1, "mode 1");
        CoreHarness h = new CoreHarness(address(l), 50_000);
        try h.action("") {
            revert("must revert");
        } catch (bytes memory r) {
            require(bytes4(r) == CallerPays.PayerIsRule.selector, "PayerIsRule contract");
        }
    }

    // ---------------------------------------------------------------- built-in stake trigger

    function _stakeSetup(uint256 fund) internal returns (MockRegistry reg, StakingRule l, CoreHarness h, bytes memory sp) {
        reg = new MockRegistry();
        l = new StakingRule(address(reg), 0.02 ether);
        h = new CoreHarness(address(l), 50_000);
        h.setMaxCost(0.001 ether); // the trigger's max_cost reservation (ethrex debits it at APPROVE)
        vm.deal(address(h), fund);
        sp = abi.encode(l.STAKE_POP_ARGS());
    }

    function test_stakePop() public {
        (MockRegistry reg, StakingRule l, CoreHarness h, bytes memory sp) = _stakeSetup(1 ether);
        require(h.condition(sp, ""), "stake trigger valid before staking");
        (, uint256 k0) = h.nonceKey(sp);
        require(k0 == l.STAKE_NONCE_KEY_BASE(), "attempt 0 key");
        reg.setFail(true);
        h.pop(sp, "");
        require(reg.stakeOf(address(h)) == 0 && h.condition(sp, ""), "failed attempt 1: still unstaked, still valid");
        (, uint256 k1) = h.nonceKey(sp);
        require(k1 == k0 + 1, "failed attempt moves to the next key");
        reg.setFail(false);
        h.pop(sp, "");
        require(reg.stakeOf(address(h)) == 0.02 ether && reg.delayOf(address(h)) == 86_400, "rule contract staked itself");
        require(!h.condition(sp, ""), "no further stake trigger");
        require(h.load(l.COUNTER()) == 0, "stake trigger never reaches the hooks");
        require(address(h).balance == 0.98 ether, "rule contract paid the stake, reservation refunded");
    }

    /// Caller-pays: a griefer pays stake triggers on an UNDERFUNDED rule contract: each one advances the key
    /// (never replayable) but is not counted, so the attempts are not burned; funded later, the rule contract stakes.
    function test_stakePop_callerPays_underfundedPopsNotCounted() public {
        (MockRegistry reg, StakingRule l, CoreHarness h, bytes memory sp) = _stakeSetup(0.01 ether);
        h.setMaxCost(0); // caller-pays: nothing is reserved from the rule contract
        (, uint256 k0) = h.nonceKey(sp);
        for (uint256 i; i < 5; i++) h.popCallerPays(sp, "", address(0xBAD));
        (, uint256 k5) = h.nonceKey(sp);
        require(k5 == k0 + 5, "each paid trigger advanced the key (no replay)");
        require(h.condition(sp, ""), "attempts not burned: stake trigger still valid");
        require(reg.stakeOf(address(h)) == 0, "not staked yet");
        vm.deal(address(h), 0.02 ether);
        h.popCallerPays(sp, "", address(0xBAD));
        require(reg.stakeOf(address(h)) == 0.02 ether, "staked once funded");
        require(!h.condition(sp, ""), "done");
        l;
    }

    /// Rule-pays: an underfunded stake trigger still counts (the rule contract paid its gas), as before.
    function test_stakePop_ruleContractPays_underfundedStillCounted() public {
        (, , CoreHarness h, bytes memory sp) = _stakeSetup(0.015 ether);
        h.pop(sp, "");
        h.pop(sp, "");
        require(!h.condition(sp, ""), "two counted attempts: off");
    }

    /// funded with exactly `amount`, the stake fails (max_cost is reserved first). At most
    /// MAX_STAKE_ATTEMPTS paid triggers, then the stake trigger is off.
    function test_stakePopUnderfundedBoundedToTwoAttempts() public {
        (MockRegistry reg, StakingRule l, CoreHarness h, bytes memory sp) = _stakeSetup(0.02 ether);
        h.pop(sp, "");
        h.pop(sp, "");
        require(reg.stakeOf(address(h)) == 0, "never staked: balance - max_cost < amount");
        require(!h.condition(sp, ""), "after 2 attempts the stake trigger is off");
        (bool ok, bytes memory r) = address(h).call(abi.encodeCall(CoreHarness.pop, (sp, "")));
        require(!ok && keccak256(r) == keccak256(abi.encodeWithSelector(CoreHarness.InvalidPop.selector, uint8(0x22))), "third: invalid");
        require(l.MAX_STAKE_ATTEMPTS() == 2, "bound");
        vm.deal(address(h), 1 ether);
        require(!h.condition(sp, ""), "still off after funding (the owner path re-enables)");
    }

    function test_stakePopFundedWithAmountPlusMaxCost() public {
        (MockRegistry reg,, CoreHarness h, bytes memory sp) = _stakeSetup(0.02 ether + 0.001 ether);
        h.pop(sp, "");
        require(reg.stakeOf(address(h)) == 0.02 ether, "amount + maxCostPerPop is enough");
    }

    /// a registry without code is refused (condition false); nothing is sent.
    function test_stakeToCodelessRegistryRefused() public {
        address noCode = address(0xBEEF1234);
        StakingRule l = new StakingRule(noCode, 1 ether);
        CoreHarness h = new CoreHarness(address(l), 50_000);
        vm.deal(address(h), 2 ether);
        bytes memory sp = abi.encode(l.STAKE_POP_ARGS());
        require(!h.condition(sp, ""), "codeless registry: invalid");
        h.action(sp); // even if forced through, the action does not send
        require(noCode.balance == 0 && address(h).balance == 2 ether, "nothing sent");
        require(h.load(bytes32(0xc89bfe4f9811a0d0750732170b5c9fc8bbcfc18b93dd900da4e8ad761f212a37)) == 2, "counted as a failed attempt");
    }

    /// A registry that accepts the call but does not record the stake does not count as staked.
    function test_stakeNotRecordedIsAFailure() public {
        LyingRegistry reg = new LyingRegistry();
        StakingRule l = new StakingRule(address(reg), 1 ether);
        CoreHarness h = new CoreHarness(address(l), 50_000);
        vm.deal(address(h), 2 ether);
        bytes memory sp = abi.encode(l.STAKE_POP_ARGS());
        h.pop(sp, "");
        require(h.condition(sp, ""), "not staked: attempt 1 of 2 used");
    }

    /// no popArgs hashed by _hashKey (or plain keccak) can equal the stake key.
    function test_hashKeyCannotHitStakeKey() public {
        (MockRegistry reg, StakingRule l, CoreHarness h, bytes memory sp) = _stakeSetup(1 ether);
        uint256 sk = l.STAKE_NONCE_KEY_BASE();
        h.pop(abi.encode(bytes32(0x9495d54c369d9ec5f7062d1b29338d185d6d0bea9571067287c78e3a4a6cd716), uint256(0)), hex"");
        h.pop(abi.encodePacked(uint8(1), sk), "");
        require(sk & type(uint120).max == 0 && sk != 0, "stake key = ASCII tag, low bytes 0 (not a keccak output)");
        h.pop(sp, "");
        require(reg.stakeOf(address(h)) == 0.02 ether, "stake trigger still runs");
    }

    /// a registry that burns all gas or reverts is caught and counted, the action does not revert.
    function test_stakeRegistryBurningGasIsCounted() public {
        BurnRegistry reg = new BurnRegistry();
        StakingRule l = new StakingRule(address(reg), 1 ether);
        CoreHarness h = new CoreHarness(address(l), 50_000);
        vm.deal(address(h), 2 ether);
        bytes memory sp = abi.encode(l.STAKE_POP_ARGS());
        h.action{gas: 2_000_000}(sp);
        require(h.load(bytes32(0xc89bfe4f9811a0d0750732170b5c9fc8bbcfc18b93dd900da4e8ad761f212a37)) == 2, "attempt counted, not staked");
        require(address(h).balance == 2 ether, "nothing sent");
    }

    function test_stakeConfigOnLogic() public {
        MockRegistry reg = new MockRegistry();
        StakingRule l = new StakingRule(address(reg), 0.02 ether);
        (address r, uint256 a, uint32 d) = l.popcornStakeConfig();
        require(r == address(reg) && a == 0.02 ether && d == 86_400, "config readable on the logic");
    }

    function test_stakePopDisabledByDefault() public {
        CounterRule l = new CounterRule();
        CoreHarness h = new CoreHarness(address(l), 50_000);
        require(!h.condition(abi.encode(l.STAKE_POP_ARGS()), ""), "disabled: condition false");
        require(h.condition(abi.encode(bytes32(uint256(l.STAKE_POP_ARGS()) + 1)), ""), "other 32-byte popArgs reach the hooks");
    }

    // ---------------------------------------------------------------- __nonceKey gas (Core gives 10,000)

    function _minNonceGas(address logic, bytes memory popArgs) internal returns (uint256) {
        NonceProbe p = new NonceProbe();
        uint256 lo = 0;
        uint256 hi = 30_000;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            uint256 id = vm.snapshotState();
            bool ok = p.run(logic, popArgs, mid);
            vm.revertToState(id);
            if (ok) hi = mid;
            else lo = mid + 1;
        }
        return lo;
    }

    event log_named_uint(string key, uint256 val);

    /// Typical keys fit NONCE_KEY_GAS = 10,000 with room (cold storage, fresh state per try).
    function test_nonceKeyGasFitsTenThousand() public {
        uint256 a = _minNonceGas(address(new EpochKeyRule()), new bytes(64));
        uint256 b = _minNonceGas(address(new TwoSloadKeyRule()), new bytes(64));
        uint256 c = _minNonceGas(address(new StakingRule(address(1), 1)), abi.encode(bytes32(0x9dd788feded4e6aa42613b012c5b0c4fc54b7a00cd0610258a6f60f98bee4894)));
        uint256 d = _minNonceGas(address(new CounterRule()), new bytes(256));
        emit log_named_uint("epoch key (abi.encode(tag, rule contract, SLOAD))", a);
        emit log_named_uint("2 cold SLOADs + hash", b);
        emit log_named_uint("stake trigger key", c);
        emit log_named_uint("_hashKey 256 bytes", d);
        require(a < 10_000 && b < 10_000 && c < 10_000 && d < 10_000, "a typical key exceeds NONCE_KEY_GAS");
    }
}

contract BurnRegistry {
    function addStake(uint32) external payable {
        while (true) {}
    }

    function getDepositInfo(address) external pure returns (uint256, uint32, uint64) {
        return (0, 0, 0);
    }
}

contract LyingRegistry {
    function addStake(uint32) external payable {}

    function getDepositInfo(address) external pure returns (uint256, uint32, uint64) {
        return (0, 0, 0);
    }
}

contract NonceProbe {
    function run(address logic, bytes calldata popArgs, uint256 g) external returns (bool ok) {
        (ok,) = logic.delegatecall{gas: g}(abi.encodeWithSelector(bytes4(0x97031c8c), popArgs));
    }
}

/// like bountyNonceKey: keccak256(abi.encode("bounty", address(this), epoch-from-storage)).
contract EpochKeyRule is RuleContract {
    function nonceKey() internal view override returns (uint256) {
        return uint256(keccak256(abi.encode("bounty", address(this), _sload(keccak256("epoch")) >> 88)));
    }

    function condition() internal pure override returns (bool) {
        return true;
    }

    function action() internal override {}
}

contract TwoSloadKeyRule is RuleContract {
    function nonceKey(bytes calldata popArgs) internal view override returns (uint256) {
        return uint256(keccak256(abi.encode(_sload(bytes32(uint256(1))), _sload(bytes32(uint256(2))), popArgs)));
    }

    function condition() internal pure override returns (bool) {
        return true;
    }

    function action() internal override {}
}
