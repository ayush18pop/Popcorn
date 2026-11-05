// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleFactory} from "src/rules/RuleFactory.sol";
import {AlwaysTrueRule} from "src/mocks/AlwaysTrueRule.sol";
import {RuleCosts} from "src/rules/RuleCosts.sol";
import {ThresholdAlarm} from "src/examples/ThresholdAlarm.sol";
import {ThresholdCondition} from "src/conditions/ThresholdCondition.sol";

interface Vm {
    function readFile(string calldata) external view returns (string memory);
    function parseBytes(string calldata) external pure returns (bytes memory);
}

/// Factory: predict == deployed, code == Core runtime ++ args, every bound, fuzzed bounds.
/// Reads core/out (run core/build.sh first).
contract RuleFactoryTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    RuleFactory f;
    address logic;
    bytes creation;
    bytes runtime;

    event RuleContractCreated(address indexed ruleContract, address indexed logic, bytes32 indexed salt, bytes args, uint256 value);

    function _bin(string memory name) internal view returns (bytes memory) {
        bytes memory b = bytes(vm.readFile(string.concat("core/out/", name)));
        uint256 n = b.length;
        while (n > 0 && (b[n - 1] == 0x0a || b[n - 1] == 0x0d)) n--;
        bytes memory o = new bytes(n);
        for (uint256 i; i < n; i++) o[i] = b[i];
        return vm.parseBytes(string.concat("0x", string(o)));
    }

    function setUp() public {
        creation = _bin("PopcornCore.bin");
        runtime = _bin("PopcornCore.runtime.bin");
        f = new RuleFactory(creation);
        logic = address(new AlwaysTrueRule());
    }

    function _good() internal view returns (RuleFactory.RuleContractArgs memory a) {
        a = RuleFactory.RuleContractArgs({
            logic: logic,
            mode: 0,
            maxFeePerGas: 3 gwei,
            maxPriorityFeePerGas: 2 gwei,
            maxGasPerFrame: 300_000,
            maxStateGasPerFrame: 200_000,
            verifier: address(0),
            conditionGas: 50_000,
            maxVerifyDataLength: 256,
            maxTriggerDataLength: 256
        });
    }

    function _noOwner() internal pure returns (RuleFactory.OwnerInit memory o) {}

    function _packed(RuleFactory.RuleContractArgs memory a) internal pure returns (bytes memory) {
        return bytes.concat(
            abi.encodePacked(a.logic, a.mode, a.maxFeePerGas, a.maxPriorityFeePerGas, a.maxGasPerFrame),
            abi.encodePacked(a.maxStateGasPerFrame, a.verifier, a.conditionGas, a.maxVerifyDataLength, a.maxTriggerDataLength)
        );
    }

    function _err(RuleFactory.RuleContractArgs memory a) internal view returns (bytes memory ret) {
        bool ok;
        (ok, ret) = address(f).staticcall(abi.encodeCall(RuleFactory.checkArgs, (a)));
        if (ok) ret = "";
    }

    // ---------------------------------------------------------------- deploy

    function test_coreCodeStoredAndHashed() public view {
        require(keccak256(f.coreCreationCode()) == keccak256(creation), "stored code == core/out/PopcornCore.bin");
        require(f.coreCreationCodeHash() == keccak256(creation), "hash");
        require(f.CORE_CREATION_CODE_HASH() == keccak256(creation), "pinned hash == core/out (re-pin after a Core change)");
        require(creation.length > runtime.length, "build");
    }

    function test_wrongCoreCodeRefused() public {
        bytes memory other = bytes.concat(creation, hex"00");
        try new RuleFactory(other) {
            revert("factory must refuse another Core build");
        } catch (bytes memory r) {
            require(bytes4(r) == RuleFactory.WrongCoreCode.selector, "WrongCoreCode");
        }
    }

    function test_predictEqualsDeployed_codeIsRuntimePlusArgs() public {
        RuleFactory.RuleContractArgs memory a = _good();
        bytes memory args = _packed(a);
        require(args.length == 101 && keccak256(f.encodeArgs(a)) == keccak256(args), "101 packed bytes, LAYOUT.md order");
        address p = f.predict(a, _noOwner(), bytes32(uint256(7)));
        address k = f.create{value: 0.5 ether}(a, _noOwner(), bytes32(uint256(7)));
        require(k == p, "predict == deployed");
        require(keccak256(k.code) == keccak256(bytes.concat(runtime, args)), "code == runtime ++ args");
        bytes memory tail = new bytes(101);
        bytes memory code = k.code;
        for (uint256 i; i < 101; i++) tail[i] = code[code.length - 101 + i];
        require(keccak256(tail) == keccak256(args), "code ends with the 101 arg bytes");
        require(k.balance == 0.5 ether, "funded in the same call");
        require(f.predict(a, _noOwner(), bytes32(uint256(8))) != p, "salt changes the address");
        a.maxFeePerGas += 1;
        require(f.predict(a, _noOwner(), bytes32(uint256(7))) != p, "args change the address");
    }

    function test_sameSaltTwiceFails() public {
        f.create(_good(), _noOwner(), bytes32(0));
        (bool ok, bytes memory r) = address(f).call(abi.encodeCall(RuleFactory.create, (_good(), _noOwner(), bytes32(0))));
        require(!ok && bytes4(r) == RuleFactory.DeployFailed.selector, "DeployFailed");
    }

    function test_maxCostPerTrigger() public view {
        RuleFactory.RuleContractArgs memory a = _good();
        require(f.maxCostPerTrigger(a) == RuleCosts.maxCostPerTrigger(3 gwei, 300_000, 200_000, 256, 256), "cost");
        require(f.maxCostPerTrigger(a) == 3 gwei * (12_950 + 64 * (256 + 68 + 256 + 35) + 600_000 + 200_000), "formula");
    }

    // ---------------------------------------------------------------- every bound, both sides

    function _expect(RuleFactory.RuleContractArgs memory a, bytes memory want) internal view {
        bytes memory got = _err(a);
        require(keccak256(got) == keccak256(want), "unexpected checkArgs result");
    }

    function test_bounds_each() public {
        RuleFactory.RuleContractArgs memory a;

        a = _good();
        _expect(a, "");

        a = _good();
        a.mode = 2;
        _expect(a, abi.encodeWithSelector(RuleFactory.ModeNotSupported.selector, uint8(2)));

        a = _good();
        a.mode = 1; // caller-pays: the fee caps are unused and must be 0
        _expect(a, abi.encodeWithSelector(RuleFactory.FeeCapsMustBeZeroInCallerPays.selector, uint256(3 gwei), uint256(2 gwei)));
        a.maxFeePerGas = 0;
        _expect(a, abi.encodeWithSelector(RuleFactory.FeeCapsMustBeZeroInCallerPays.selector, uint256(0), uint256(2 gwei)));
        a.maxPriorityFeePerGas = 0;
        _expect(a, "");

        a = _good();
        a.logic = address(0xdead);
        _expect(a, abi.encodeWithSelector(RuleFactory.LogicHasNoCode.selector, address(0xdead)));

        a = _good();
        a.verifier = address(0xbeef);
        _expect(a, abi.encodeWithSelector(RuleFactory.VerifierHasNoCode.selector, address(0xbeef)));
        a.verifier = logic; // any contract
        _expect(a, "");

        a = _good();
        a.maxFeePerGas = 0;
        a.maxPriorityFeePerGas = 0;
        _expect(a, abi.encodeWithSelector(RuleFactory.MaxFeeOutOfRange.selector, 0));
        a.maxFeePerGas = 1;
        _expect(a, "");
        a.maxFeePerGas = 1_000 gwei;
        _expect(a, "");
        a.maxFeePerGas = 1_000 gwei + 1;
        _expect(a, abi.encodeWithSelector(RuleFactory.MaxFeeOutOfRange.selector, 1_000 gwei + 1));

        a = _good();
        a.maxPriorityFeePerGas = a.maxFeePerGas;
        _expect(a, "");
        a.maxPriorityFeePerGas = a.maxFeePerGas + 1;
        _expect(a, abi.encodeWithSelector(RuleFactory.PriorityFeeAboveMaxFee.selector, 3 gwei + 1, 3 gwei));

        a = _good();
        a.maxGasPerFrame = 16_777_216; // within the per-frame bound, but no trigger fits EIP-7825 with it
        _expect(a, abi.encodeWithSelector(RuleFactory.TxGasAboveCap.selector, f.minTxExecutionGas(a)));
        a.maxGasPerFrame = 16_777_217;
        _expect(a, abi.encodeWithSelector(RuleFactory.GasPerFrameTooHigh.selector, 16_777_217));

        a = _good();
        a.maxStateGasPerFrame = 64 * 97_920;
        _expect(a, "");
        a.maxStateGasPerFrame = 64 * 97_920 + 1;
        _expect(a, abi.encodeWithSelector(RuleFactory.StateGasTooHigh.selector, 64 * 97_920 + 1));

        a = _good();
        a.maxGasPerFrame = 400_000;
        a.maxVerifyDataLength = 8_192;
        _expect(a, "");
        a.maxVerifyDataLength = 8_193;
        _expect(a, abi.encodeWithSelector(RuleFactory.VerifyDataTooLong.selector, 8_193));

        a = _good();
        a.maxGasPerFrame = 400_000;
        a.maxTriggerDataLength = 4_096;
        _expect(a, "");
        a.maxTriggerDataLength = 4_097;
        _expect(a, abi.encodeWithSelector(RuleFactory.TriggerDataTooLong.selector, 4_097));

        a = _good();
        a.conditionGas = 5_000;
        _expect(a, "");
        a.conditionGas = 4_999;
        _expect(a, abi.encodeWithSelector(RuleFactory.ConditionGasTooLow.selector, 4_999));
    }

    function test_bounds_verifyFloorRelativeToGasPerFrame() public {
        RuleFactory.RuleContractArgs memory a = _good();
        // floor at caps = 10,000 + cg + cg/63 + 7,000 + 256 + (68 + 256) = 17,580 + cg + cg/63
        a.conditionGas = 50_000;
        a.maxGasPerFrame = 17_580 + 50_000 + 793;
        require(f.verifyFloorAtCaps(a) == a.maxGasPerFrame, "floor formula");
        _expect(a, "");
        a.maxGasPerFrame -= 1;
        _expect(a, abi.encodeWithSelector(RuleFactory.VerifyFloorAboveGasPerFrame.selector, 17_580 + 50_793, 17_580 + 50_792));
        // a  proof rule contract: conditionGas 220,000 needs maxGasPerFrame >= 241,072; allowed (relative bound)
        a.conditionGas = 220_000;
        a.maxGasPerFrame = 250_000;
        _expect(a, "");
    }

    /// EIP-7825: intrinsic (12,950 + 16/byte) + VERIFY floor + pinned SENDER limit <= 2^24.
    function test_bounds_txGasCap() public {
        RuleFactory.RuleContractArgs memory a = _good();
        a.maxGasPerFrame = 8_500_000;
        a.conditionGas = 8_300_000;
        uint256 t = f.minTxExecutionGas(a);
        require(t == 12_950 + 16 * (256 + 324 + 35) + f.verifyFloorAtCaps(a) + 8_500_000, "formula");
        require(f.verifyFloorAtCaps(a) <= a.maxGasPerFrame && t > 16_777_216, "setup: only the tx cap fails");
        _expect(a, abi.encodeWithSelector(RuleFactory.TxGasAboveCap.selector, t));
        a.conditionGas = 8_000_000;
        require(f.minTxExecutionGas(a) <= 16_777_216, "setup");
        _expect(a, "");
    }

    /// Staking logic: the rule contract must be able to run the stake trigger.
    function test_bounds_stakeNeeds() public {
        StakeReg reg = new StakeReg();
        RuleFactory.RuleContractArgs memory a = _good();
        a.logic = address(new ThresholdAlarm(address(1), bytes4(0), 0, ThresholdCondition.Direction.Above, 0.01 ether));
        // ThresholdAlarm stakes to the devnet registry, which has no code in this test chain
        _expect(a, abi.encodeWithSelector(RuleFactory.StakeRegistryHasNoCode.selector, 0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F));
        a.logic = address(new RegStakeRule(address(reg)));
        a.maxStateGasPerFrame = 293_759;
        _expect(a, abi.encodeWithSelector(RuleFactory.StakeNeedsStateGas.selector, 293_759, 293_760));
        a.maxStateGasPerFrame = 293_760;
        a.maxGasPerFrame = 79_999;
        a.conditionGas = 5_000;
        a.maxVerifyDataLength = 0;
        _expect(a, abi.encodeWithSelector(RuleFactory.StakeNeedsGasPerFrame.selector, 79_999, 80_000));
        a.maxGasPerFrame = 80_000;
        a.maxTriggerDataLength = 31;
        _expect(a, abi.encodeWithSelector(RuleFactory.StakeNeedsTriggerData.selector, 31));
        a.maxTriggerDataLength = 32;
        _expect(a, "");
    }

    // ---------------------------------------------------------------- caller-pays (mode 1, Core)

    function _sp() internal view returns (RuleFactory.RuleContractArgs memory a) {
        a = _good();
        a.mode = 1;
        a.maxFeePerGas = 0;
        a.maxPriorityFeePerGas = 0;
    }

    function test_callerPays_deploys_costsTheRuleContractNothing() public {
        RuleFactory.RuleContractArgs memory a = _sp();
        require(f.maxCostPerTrigger(a) == 0, "the payer pays every trigger");
        address k = f.create(a, _noOwner(), bytes32(uint256(61)));
        require(keccak256(k.code) == keccak256(bytes.concat(runtime, _packed(a))), "code == runtime ++ args (mode byte 1)");
    }

    function test_logicModeMustMatch() public {
        address sp = address(new SpLogic());
        RuleFactory.RuleContractArgs memory a = _good();
        a.logic = sp; // a CallerPays logic in a rule-pays rule contract
        _expect(a, abi.encodeWithSelector(RuleFactory.ModeMismatch.selector, uint8(0), uint8(1)));
        a = _sp();
        a.logic = sp;
        _expect(a, "");
        a.logic = address(new SpRulePaysLogic()); // a RulePays logic in a caller-pays rule contract
        _expect(a, abi.encodeWithSelector(RuleFactory.ModeMismatch.selector, uint8(1), uint8(0)));
    }

    function test_callerPays_txGasBound() public view {
        RuleFactory.RuleContractArgs memory a = _sp();
        uint256 n1 = 68 + 256;
        uint256 floor = 10_000 + 50_000 + 793 + 7_000 + 256 + n1; // 50,000 / 63 = 793
        require(f.minTxExecutionGas(a) == 16_800 + 16 * (256 + n1 + 35 + 150) + floor + 300_000 + 60_000, "mode 1 EIP-7825 bound");
        a.maxGasPerFrame = uint64(16_777_216 - (f.minTxExecutionGas(a) - 300_000) + 1);
        _expect(a, abi.encodeWithSelector(RuleFactory.TxGasAboveCap.selector, 16_777_217));
    }

    /// The mode-1 public prefix budget is a WARNING helper, not a bound.
    function test_prefixGasAtCaps() public view {
        RuleFactory.RuleContractArgs memory a = _sp();
        uint256 floor = f.verifyFloorAtCaps(a);
        require(f.prefixGasAtCaps(a) == floor + 30_000 + 2_900, "mode 1: floor + payer frame + EOA signatures");
        require(!f.fitsPublicPrefixBudget(a), "cg 50k + data caps 256/256: over 100k on public paths");
        _expect(a, ""); // still deployable: local / patched sidecars allow 250k
        a.conditionGas = 20_000;
        a.maxVerifyDataLength = 0;
        a.maxTriggerDataLength = 64;
        require(f.prefixGasAtCaps(a) == 37_449 + 32_900 && f.fitsPublicPrefixBudget(a), "the RewardRule contract profile fits");
        RuleFactory.RuleContractArgs memory b = _good();
        require(f.prefixGasAtCaps(b) == f.verifyFloorAtCaps(b), "mode 0: the floor");
    }

    // ---------------------------------------------------------------- fuzz: checkArgs == the bounds model

    function _model(RuleFactory.RuleContractArgs memory a) internal view returns (bool) {
        uint256 n1 = 68 + ((uint256(a.maxTriggerDataLength) + 31) / 32) * 32;
        uint256 floor = 10_000 + uint256(a.conditionGas) + uint256(a.conditionGas) / 63 + 7_000 + a.maxVerifyDataLength + n1;
        uint256 txGas = 12_950 + 16 * (uint256(a.maxVerifyDataLength) + n1 + 35) + floor + a.maxGasPerFrame;
        return a.mode == 0 && a.logic.code.length > 0 && (a.verifier == address(0) || a.verifier.code.length > 0)
            && a.maxFeePerGas > 0 && a.maxFeePerGas <= 1_000 gwei && a.maxPriorityFeePerGas <= a.maxFeePerGas
            && a.maxGasPerFrame <= 16_777_216 && a.maxStateGasPerFrame <= 6_266_880 && a.maxVerifyDataLength <= 8_192
            && a.maxTriggerDataLength <= 4_096 && a.conditionGas >= 5_000 && floor <= a.maxGasPerFrame && txGas <= 16_777_216;
    }

    function testFuzz_boundsMatchModel(
        uint8 mode,
        uint128 fee,
        uint128 tip,
        uint64 gasPerFrame,
        uint64 state,
        uint32 cg,
        uint32 vd,
        uint32 pa,
        uint8 pick
    ) public {
        RuleFactory.RuleContractArgs memory a = RuleFactory.RuleContractArgs({
            logic: pick % 5 == 0 ? address(0xdead) : logic,
            mode: mode % 4 == 0 ? mode : 0,
            // bias the fuzzer towards the interesting ranges as well as the full ones
            maxFeePerGas: pick % 2 == 0 ? fee % (2_000 gwei) : fee,
            maxPriorityFeePerGas: pick % 3 == 0 ? tip : tip % (2_000 gwei),
            maxGasPerFrame: pick % 2 == 1 ? gasPerFrame % 20_000_000 : gasPerFrame,
            maxStateGasPerFrame: state % 8_000_000,
            verifier: pick % 7 == 0 ? address(0xbeef) : address(0),
            conditionGas: cg % 1_000_000,
            maxVerifyDataLength: vd % 10_000,
            maxTriggerDataLength: pa % 5_000
        });
        bool ok = _err(a).length == 0;
        require(ok == _model(a), "checkArgs disagrees with the bounds model");
        if (ok) {
            address k = f.create(a, _noOwner(), bytes32(uint256(pick)));
            require(keccak256(k.code) == keccak256(bytes.concat(runtime, _packed(a))), "deployed");
        } else {
            (bool s,) = address(f).call(abi.encodeCall(RuleFactory.create, (a, _noOwner(), bytes32(uint256(pick)))));
            require(!s, "create must refuse what checkArgs refuses");
        }
    }

    /// Valid args by construction (each field inside its bound, maxGasPerFrame >= the floor): always deploys, at predict().
    function testFuzz_validArgsDeployAtPrediction(uint128 fee, uint128 tip, uint32 cg, uint32 vd, uint32 pa, uint64 extra, uint64 state, bytes32 salt)
        public
    {
        RuleFactory.RuleContractArgs memory a = _good();
        a.maxFeePerGas = 1 + fee % 1_000 gwei;
        a.maxPriorityFeePerGas = tip % (a.maxFeePerGas + 1);
        a.conditionGas = uint32(5_000 + cg % 2_000_000);
        a.maxVerifyDataLength = vd % 8_193;
        a.maxTriggerDataLength = pa % 4_097;
        a.maxStateGasPerFrame = state % 6_266_881;
        uint256 floor = f.verifyFloorAtCaps(a);
        a.maxGasPerFrame = uint64(floor);
        uint256 room = 16_777_216 - f.minTxExecutionGas(a); // SENDER limit can still grow by this much
        a.maxGasPerFrame = uint64(floor + extra % (room + 1));
        require(_err(a).length == 0, "valid args rejected");
        address p = f.predict(a, _noOwner(), salt);
        require(f.create(a, _noOwner(), salt) == p, "predict == deployed");
        require(keccak256(p.code) == keccak256(bytes.concat(runtime, _packed(a))), "code");
    }

    receive() external payable {}
}

contract SpLogic {
    function popcornMode() external pure returns (uint8) {
        return 1;
    }
}

contract SpRulePaysLogic {
    function popcornMode() external pure returns (uint8) {
        return 0;
    }
}

contract StakeReg {
    function addStake(uint32) external payable {}
}

contract RegStakeRule is ThresholdAlarm {
    address immutable reg;

    constructor(address r) ThresholdAlarm(address(1), bytes4(0), 0, ThresholdCondition.Direction.Above, 0.01 ether) {
        reg = r;
    }

    function _stakeConfig() internal view override returns (address, uint256, uint32) {
        return (reg, 0.01 ether, 86_400);
    }
}
