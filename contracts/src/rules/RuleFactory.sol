// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleCosts} from "src/rules/RuleCosts.sol";

/// @title RuleFactory
/// @notice Deploys Popcorn rule contracts: CREATE2 of `Core creation code ++ 101 packed args ++ 84 owner bytes` (core/LAYOUT.md), after checking
///         the args against deploy bounds. Core itself only checks the args
///         length, that logic has code and mode <= 1; everything else here protects the deployer from a rule contract that
///         can never trigger, or that triggers at an absurd cost.
///
///         Modes: 0 rule-pays (fee caps bound what one trigger can cost the rule contract), 1 caller-pays (a separate
///         payer pays every trigger; Core ignores the fee caps, so they must be 0 here and maxCostPerTrigger is 0). If the logic
///         reports `popcornMode()` (RulePays / CallerPays), it must equal `mode`.
///
///         Core code: passed to the constructor (the bytes of core/out/PopcornCore.bin from core/build.sh), checked
///         against CORE_CREATION_CODE_HASH (pinned here, so NONCE_KEY_GAS / VERIFY_FIXED_GAS below cannot drift from
///         the Core they describe; contracts/test/RuleFactory.t.sol fails if core/out no longer matches), and kept
///         in a data contract (SSTORE2-style: runtime = 0x00 ++ code). One factory per Core build.
///
///         Stake: the factory cannot stake a rule contract (the registry keys stake by msg.sender = the rule contract). A logic
///         inheriting RuleContract stakes itself with the built-in stake trigger (RuleStake): fund the rule contract here
///         with `value`, then trigger it with popArgs = STAKE_POP_ARGS.
contract RuleFactory {
    /// @notice The 101-byte Core argument record (core/LAYOUT.md "Argument layout", same order).
    struct RuleContractArgs {
        address logic;
        uint8 mode;
        uint128 maxFeePerGas;
        uint128 maxPriorityFeePerGas;
        uint64 maxGasPerFrame;
        uint64 maxStateGasPerFrame;
        address verifier;
        uint32 conditionGas;
        uint32 maxVerifyDataLength;
        uint32 maxTriggerDataLength;
    }

    /// @notice The hybrid owner: written by Core's constructor into the owner slots, not
    ///         part of the deployed code. All zero = no owner (the owner path is off). Otherwise all three must be non-zero.
    struct OwnerInit {
        address ecdsa;
        bytes32 wotsRoot;
        bytes32 wotsPubSeed;
    }

    uint256 public constant ARGS_LENGTH = 101;
    /// @notice Owner bytes appended to the initcode after the 101 args: ecdsa (20) ++ wotsRoot (32) ++ wotsPubSeed (32).
    uint256 public constant OWNER_INIT_LENGTH = 84;

    /// @notice keccak256 of the Core creation code this factory accepts (core/out/PopcornCore.bin).
    bytes32 public constant CORE_CREATION_CODE_HASH = 0xe83219d7b565dcd7556f275bc9e1a7345ff1e4996682a45f4801e182e1623e54;

    // Core constants (core/PopcornCore.yul) used by the VERIFY floor bound; valid for CORE_CREATION_CODE_HASH only.
    uint256 public constant NONCE_KEY_GAS = 10_000;
    uint256 public constant VERIFY_FIXED_GAS = 7_000;
    uint256 public constant MANDATORY_GAS = 12_950; // 12,000 + 2 frames x 475
    /// @notice Mode 1 intrinsic for the EIP-7825 bound: 12,000 + 4 frames x 475 + an EOA payer's signatures (100 + 2,800).
    uint256 public constant MANDATORY_GAS_SENDER_PAYS = 16_800;
    /// @notice Mode 1: execution limit budgeted for the payer's VERIFY frame (20,000 nonce first-use + its own check)
    ///         and for an optional DEFAULT tail, in the EIP-7825 bound. Both are the payer's choice; this is a floor.
    uint256 public constant PAYER_FRAME_GAS = 30_000;
    /// @notice Signature cost of an EOA payer (ARBITRARY placeholder 100 + SECP256K1 2,800), counted in the prefix budget.
    uint256 public constant EOA_PAYER_SIG_GAS = 2_900;
    /// @notice Flat prefix budget of public ethrex and the upstream sidecar (core/SPEC.md §9). Local / patched sidecars:
    ///         250,000 unstaked, 2,500,000 staked. Informational: checkArgs does NOT enforce it.
    uint256 public constant PUBLIC_PREFIX_BUDGET = 100_000;
    /// @notice EIP-7825 cap on frame_tx_intrinsic_gas + Σ frame execution limits (EIP-8141; state gas excluded).
    uint256 public constant TX_GAS_CAP = 16_777_216;

    // Deploy bounds.
    uint256 public constant MAX_FEE_CEILING = 1_000 gwei;
    uint256 public constant MAX_GAS_PER_FRAME = 16_777_216; // EIP-7825 per-tx cap; the SENDER limit equals it
    uint256 public constant MIN_CONDITION_GAS = 5_000;
    uint256 public constant MAX_STATE_GAS_PER_FRAME = 64 * 97_920; // 64 fresh slots per action
    uint256 public constant MAX_VERIFY_DATA_LENGTH = 8_192; // a Groth16 proof is 256 bytes; each byte costs up to 64 gas
    uint256 public constant MAX_TRIGGER_DATA_LENGTH = 4_096;
    uint256 public constant STAKE_STATE_GAS = 3 * 97_920; // RuleStake: attempt record + registry stake + delay
    uint256 public constant STAKE_EXEC_GAS = 80_000; // RuleStake.STAKE_EXEC_GAS (measured SENDER ~52k)

    /// @notice Data contract holding the Core creation code (code[1:]).
    address public immutable coreCodeStore;
    /// @notice keccak256 of the Core creation code (= keccak256 of core/out/PopcornCore.bin's bytes).
    bytes32 public immutable coreCreationCodeHash;

    event RuleContractCreated(address indexed ruleContract, address indexed logic, bytes32 indexed salt, bytes args, uint256 value);
    /// @notice Emitted with Rule contractCreated when the rule contract has an owner (the owner keys are public: they are in the tx).
    event RuleContractOwnerSet(address indexed ruleContract, address indexed ecdsa, bytes32 wotsRoot, bytes32 wotsPubSeed);

    error EmptyCoreCode();
    error OwnerInitInvalid();
    error StoreFailed();
    error ModeNotSupported(uint8 mode);
    error ModeMismatch(uint8 mode, uint8 logicMode);
    error FeeCapsMustBeZeroInCallerPays(uint256 maxFeePerGas, uint256 maxPriorityFeePerGas);
    error LogicHasNoCode(address logic);
    error VerifierHasNoCode(address verifier);
    error MaxFeeOutOfRange(uint256 maxFeePerGas);
    error PriorityFeeAboveMaxFee(uint256 maxPriorityFeePerGas, uint256 maxFeePerGas);
    error GasPerFrameTooHigh(uint256 maxGasPerFrame);
    error StateGasTooHigh(uint256 maxStateGasPerFrame);
    error ConditionGasTooLow(uint256 conditionGas);
    error VerifyFloorAboveGasPerFrame(uint256 floorAtCaps, uint256 maxGasPerFrame);
    error VerifyDataTooLong(uint256 maxVerifyDataLength);
    error TriggerDataTooLong(uint256 maxTriggerDataLength);
    error DeployFailed();
    error WrongCoreCode(bytes32 got);
    error TxGasAboveCap(uint256 minTxExecutionGas);
    error StakeRegistryHasNoCode(address registry);
    error StakeNeedsStateGas(uint256 maxStateGasPerFrame, uint256 needed);
    error StakeNeedsGasPerFrame(uint256 maxGasPerFrame, uint256 needed);
    error StakeNeedsTriggerData(uint256 maxTriggerDataLength);

    constructor(bytes memory coreCreationCode_) {
        if (coreCreationCode_.length == 0) revert EmptyCoreCode();
        if (keccak256(coreCreationCode_) != CORE_CREATION_CODE_HASH) revert WrongCoreCode(keccak256(coreCreationCode_));
        // initcode: PUSH4 len+1, DUP1, PUSH1 14, PUSH1 0, CODECOPY, PUSH1 0, RETURN ++ 0x00 ++ code
        bytes memory init =
            bytes.concat(hex"63", bytes4(uint32(coreCreationCode_.length + 1)), hex"80600e6000396000f3", hex"00", coreCreationCode_);
        address store;
        assembly ("memory-safe") {
            store := create(0, add(init, 0x20), mload(init))
        }
        if (store == address(0)) revert StoreFailed();
        coreCodeStore = store;
        coreCreationCodeHash = keccak256(coreCreationCode_);
    }

    /// @notice The Core creation code this factory deploys.
    function coreCreationCode() public view returns (bytes memory code) {
        address s = coreCodeStore;
        assembly ("memory-safe") {
            let n := sub(extcodesize(s), 1)
            code := mload(0x40)
            mstore(code, n)
            extcodecopy(s, add(code, 0x20), 1, n)
            mstore(0x40, add(add(code, 0x20), and(add(n, 31), not(31))))
        }
    }

    /// @notice The 101 packed argument bytes (core/LAYOUT.md): what the deployed code keeps.
    function encodeArgs(RuleContractArgs calldata a) public pure returns (bytes memory) {
        bytes memory head = abi.encodePacked(a.logic, a.mode, a.maxFeePerGas, a.maxPriorityFeePerGas, a.maxGasPerFrame);
        return bytes.concat(
            head, abi.encodePacked(a.maxStateGasPerFrame, a.verifier, a.conditionGas, a.maxVerifyDataLength, a.maxTriggerDataLength)
        );
    }

    /// @notice Smallest VERIFY limit Core accepts for a trigger with data at the caps (check 0x27).
    function verifyFloorAtCaps(RuleContractArgs calldata a) public pure returns (uint256) {
        uint256 n1 = 68 + ((uint256(a.maxTriggerDataLength) + 31) / 32) * 32;
        uint256 cg = a.conditionGas;
        return NONCE_KEY_GAS + cg + cg / 63 + VERIFY_FIXED_GAS + a.maxVerifyDataLength + n1;
    }

    /// @notice Smallest frame_tx_intrinsic_gas + Σ execution limits of a trigger with data at the caps: intrinsic (12,950
    ///         + at most 16 gas per data byte) + the VERIFY floor + the pinned SENDER limit. Must be <= TX_GAS_CAP.
    ///         Mode 1: intrinsic 16,800 (4 frames, EOA payer signatures; ~150 signature bytes at 16 gas) + the payer
    ///         frame and the tail at PAYER_FRAME_GAS each.
    function minTxExecutionGas(RuleContractArgs calldata a) public pure returns (uint256) {
        uint256 n1 = 68 + ((uint256(a.maxTriggerDataLength) + 31) / 32) * 32;
        if (a.mode == 1) {
            uint256 intrinsicSp = MANDATORY_GAS_SENDER_PAYS + 16 * (uint256(a.maxVerifyDataLength) + n1 + 35 + 150);
            return intrinsicSp + verifyFloorAtCaps(a) + a.maxGasPerFrame + 2 * PAYER_FRAME_GAS;
        }
        uint256 intrinsic = MANDATORY_GAS + 16 * (uint256(a.maxVerifyDataLength) + n1 + 35);
        return intrinsic + verifyFloorAtCaps(a) + a.maxGasPerFrame;
    }

    /// @notice Smallest validation-prefix gas (declared VERIFY limits + signature cost) of a trigger with data at the caps:
    ///         mode 0 the VERIFY floor (frame 0 is the whole prefix); mode 1 the floor + an EOA payer's frame
    ///         (PAYER_FRAME_GAS) + its signatures (EOA_PAYER_SIG_GAS). A WARNING helper: above
    ///         PUBLIC_PREFIX_BUDGET such triggers are refused by public ethrex / the upstream sidecar, but local and patched
    ///         sidecars allow 250k / 2.5M, so checkArgs does not reject it.
    function prefixGasAtCaps(RuleContractArgs calldata a) public pure returns (uint256) {
        uint256 floor = verifyFloorAtCaps(a);
        return a.mode == 1 ? floor + PAYER_FRAME_GAS + EOA_PAYER_SIG_GAS : floor;
    }

    /// @notice prefixGasAtCaps(a) <= PUBLIC_PREFIX_BUDGET (100,000).
    function fitsPublicPrefixBudget(RuleContractArgs calldata a) external pure returns (bool) {
        return prefixGasAtCaps(a) <= PUBLIC_PREFIX_BUDGET;
    }

    /// @notice Reverts with the first bound the args break; returns normally if all hold.
    function checkArgs(RuleContractArgs calldata a) public view {
        if (a.mode > 1) revert ModeNotSupported(a.mode); // Core: 0 rule-pays, 1 caller-pays
        if (a.logic.code.length == 0) revert LogicHasNoCode(a.logic);
        _checkLogicMode(a);
        if (a.verifier != address(0) && a.verifier.code.length == 0) revert VerifierHasNoCode(a.verifier);
        if (a.mode == 1) {
            // the payer pays and picks the fees; Core ignores the caps, so a non-zero value would only mislead
            if (a.maxFeePerGas != 0 || a.maxPriorityFeePerGas != 0) revert FeeCapsMustBeZeroInCallerPays(a.maxFeePerGas, a.maxPriorityFeePerGas);
        } else {
            if (a.maxFeePerGas == 0 || a.maxFeePerGas > MAX_FEE_CEILING) revert MaxFeeOutOfRange(a.maxFeePerGas);
            if (a.maxPriorityFeePerGas > a.maxFeePerGas) revert PriorityFeeAboveMaxFee(a.maxPriorityFeePerGas, a.maxFeePerGas);
        }
        if (a.maxGasPerFrame > MAX_GAS_PER_FRAME) revert GasPerFrameTooHigh(a.maxGasPerFrame);
        if (a.maxStateGasPerFrame > MAX_STATE_GAS_PER_FRAME) revert StateGasTooHigh(a.maxStateGasPerFrame);
        if (a.maxVerifyDataLength > MAX_VERIFY_DATA_LENGTH) revert VerifyDataTooLong(a.maxVerifyDataLength);
        if (a.maxTriggerDataLength > MAX_TRIGGER_DATA_LENGTH) revert TriggerDataTooLong(a.maxTriggerDataLength);
        if (a.conditionGas < MIN_CONDITION_GAS) revert ConditionGasTooLow(a.conditionGas);
        uint256 floor = verifyFloorAtCaps(a);
        if (floor > a.maxGasPerFrame) revert VerifyFloorAboveGasPerFrame(floor, a.maxGasPerFrame);
        uint256 txGas = minTxExecutionGas(a);
        if (txGas > TX_GAS_CAP) revert TxGasAboveCap(txGas);
        _checkStake(a);
    }

    /// @dev A logic that reports popcornMode() (RulePays: 0, CallerPays: 1) must be deployed in that mode: a caller-pays
    ///      logic under rule-pays would make the rule contract pay gas for triggers whose reward logic expects a separate payer.
    function _checkLogicMode(RuleContractArgs calldata a) internal view {
        (bool ok, bytes memory ret) = a.logic.staticcall(abi.encodeWithSignature("popcornMode()"));
        if (!ok || ret.length != 32) return; // logic does not declare a mode
        uint256 m = abi.decode(ret, (uint256));
        if (m != a.mode) revert ModeMismatch(a.mode, uint8(m));
    }

    /// @dev If the logic reports staking on (RuleStake.popcornStakeConfig() amount > 0), the rule contract must be able to
    ///      run the stake trigger: registry with code, 3 fresh slots of state gas, exec gas, 32-byte popArgs.
    function _checkStake(RuleContractArgs calldata a) internal view {
        (bool ok, bytes memory ret) = a.logic.staticcall(abi.encodeWithSignature("popcornStakeConfig()"));
        if (!ok || ret.length != 96) return; // not a RuleContract, or no stake support
        (address registry, uint256 amount,) = abi.decode(ret, (address, uint256, uint32));
        if (amount == 0) return;
        if (registry.code.length == 0) revert StakeRegistryHasNoCode(registry);
        if (a.maxStateGasPerFrame < STAKE_STATE_GAS) revert StakeNeedsStateGas(a.maxStateGasPerFrame, STAKE_STATE_GAS);
        if (a.maxGasPerFrame < STAKE_EXEC_GAS) revert StakeNeedsGasPerFrame(a.maxGasPerFrame, STAKE_EXEC_GAS);
        if (a.maxTriggerDataLength < 32) revert StakeNeedsTriggerData(a.maxTriggerDataLength);
    }

    /// @notice The 84 owner bytes of the initcode: ecdsa ++ wotsRoot ++ wotsPubSeed.
    function encodeOwnerInit(OwnerInit calldata o) public pure returns (bytes memory) {
        return abi.encodePacked(o.ecdsa, o.wotsRoot, o.wotsPubSeed);
    }

    /// @notice Reverts unless the owner is all zero (no owner) or all set.
    function checkOwner(OwnerInit calldata o) public view {
        bool none = o.ecdsa == address(0);
        if (o.ecdsa.code.length != 0) revert OwnerInitInvalid(); // a contract can never produce an ecrecover signature: it would lock the owner out
        if (none ? (o.wotsRoot != 0 || o.wotsPubSeed != 0) : (o.wotsRoot == 0 || o.wotsPubSeed == 0)) revert OwnerInitInvalid();
    }

    /// @notice Core creation code ++ 101 args ++ 84 owner bytes.
    function initCode(RuleContractArgs calldata a, OwnerInit calldata o) public view returns (bytes memory) {
        return bytes.concat(coreCreationCode(), encodeArgs(a), encodeOwnerInit(o));
    }

    /// @notice The address `create(a, o, salt)` deploys to (from any caller).
    function predict(RuleContractArgs calldata a, OwnerInit calldata o, bytes32 salt) external view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(initCode(a, o))));
        return address(uint160(uint256(h)));
    }

    /// @notice Worst-case wei one trigger can reserve from this rule contract = its minimum operating balance.
    ///         Mode 1 (caller-pays): 0, the payer pays every trigger.
    function maxCostPerTrigger(RuleContractArgs calldata a) external pure returns (uint256) {
        if (a.mode == 1) return 0;
        return RuleCosts.maxCostPerTrigger(a.maxFeePerGas, a.maxGasPerFrame, a.maxStateGasPerFrame, a.maxVerifyDataLength, a.maxTriggerDataLength);
    }

    /// @notice Deploys a rule contract with CREATE2 and funds it with msg.value (Core's deploy code accepts value).
    function create(RuleContractArgs calldata a, OwnerInit calldata o, bytes32 salt) external payable returns (address ruleContract) {
        checkArgs(a);
        checkOwner(o);
        bytes memory args = encodeArgs(a);
        bytes memory init = bytes.concat(coreCreationCode(), args, encodeOwnerInit(o));
        uint256 v = msg.value;
        assembly ("memory-safe") {
            ruleContract := create2(v, add(init, 0x20), mload(init), salt)
        }
        if (ruleContract == address(0)) revert DeployFailed();
        emit RuleContractCreated(ruleContract, a.logic, salt, args, v);
        if (o.ecdsa != address(0)) emit RuleContractOwnerSet(ruleContract, o.ecdsa, o.wotsRoot, o.wotsPubSeed);
    }
}
