// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleStake} from "src/rules/RuleStake.sol";

/// @title RuleContract
/// @notice Base contract for the logic of a Popcorn rule contract. A rule contract is a Popcorn Core deployment (core/PopcornCore.yul)
///         whose immutable `logic` argument points at a contract inheriting this one. Core DELEGATECALLs the three
///         reserved entry points below (exact ABI: core/ABI.md), so every hook runs in the RULE CONTRACT's storage, balance
///         and address: `address(this)` is the rule contract, never this logic contract.
///
///         A developer implements three hooks (each has a full form and a no-argument convenience form; override
///         exactly one form of each):
///
///           nonceKey(popArgs)              view  -> uint256   which one-shot key this trigger consumes (must be != 0)
///           condition(popArgs, verifyData) view  -> bool      true = the trigger is valid and the rule contract pays for it
///           action(popArgs, payer)                            what the trigger does (SENDER frame)
///
///         NONCE KEYS DECIDE HOW MANY PAID POPS EXIST. In rule-pays mode anyone can build a trigger and the rule contract pays
///         for each valid one, so the number of distinct keys for which condition() is true is the number of triggers anyone
///         can make the rule contract pay for (and run the action for). Derive the key from rule contract state that the action
///         advances (an epoch or counter: keccak256(abi.encode("pause", pauseEpoch)), like bountyNonceKey),
///         or use a constant for a one-shot rule contract. Do NOT derive it from popArgs alone (the triggerer picks popArgs:
///         keccak256(popArgs) gives one fresh key per popArgs, i.e. unlimited paid triggers once the condition is true).
///         `_hashKey(popArgs)` is only safe when each popArgs can be valid once by construction, e.g. it names a claim
///         id the action marks as used and the condition rejects, or it is bound to a proof only one party can make.
///
///         Payer: in rule-pays mode `payer` == the rule contract itself (Core passes address(this)). A reward to "whoever
///         triggered" must go to a recipient named in popArgs, which a mempool observer can copy into its own trigger
///         (accepted), or be bound to that recipient by a proof (ProofCondition).
///
///         VERIFY rules for nonceKey/condition (core/SPEC.md §9): static, no TIMESTAMP/NUMBER/BALANCE/GAS (unless right
///         before a CALL), no TLOAD/TSTORE; read only the rule contract's own storage unless the rule contract is staked (sidecar)
///         and ethrex's canonical rule is acceptable (it flags any other contract's SLOAD). __nonceKey gets 10,000 gas (a hash and a couple of SLOADs: ~3-5k);
///         __condition gets exactly the rule contract's `conditionGas` (Core check 0x27 guarantees the full amount).
///
///         Storage: use ERC-7201 namespaced slots. Configuration lives in this contract's immutables (constructor) or
///         in the rule contract's own code args; there is no initializer run by Core.
///
///         FORWARDED CALLS. Any call to the rule contract from a caller other than 0xaa (the frame entry point) and
///         the rule contract itself, with >= 4 bytes of calldata, is DELEGATECALLed to this logic: ordinary public/external
///         functions of the logic become the rule contract's API (e.g. a vault's deposit/withdraw), run in the rule contract's storage,
///         and can change the state the condition reads. Semantics for those functions:
///           - msg.sender is the external caller (an EOA, a contract, or another tx's SENDER frame), never 0xaa or the
///             rule contract; msg.value is what the caller sent (DELEGATECALL keeps it).
///           - Core refuses the four reserved selectors (0x38), calldata under 4 bytes (0x3a), and any forwarded call
///             while __action runs (0x39, the SENDER lock): a forwarded function never runs inside a trigger's action, and
///             __action never runs because of a forwarded call. So `_inAction()` is always false in them.
///           - They are not static and may write any rule contract storage, including RuleStake's slots and Core's
///             transient lock slot: same trust as `action`. Do not write those; keep user state in your own namespace.
///           - Mark them `forwarded` so that calling them on the logic contract itself (not through a rule contract) reverts.
///           - The condition must not call them (they may TLOAD via _inAction/_payer, banned in VERIFY).
///           - A logic calling address(this).fn() reaches Core's SENDER routine (caller == self), which Core
///             runs only in the rule contract's own trigger (tx.sender == rule contract, frame 1): from a forwarded function it reverts
///             0x3b (or halts outside a frame tx), inside __action it reverts 0x37. Use internal calls.
///         A logic without public functions behaves as under Core (the DELEGATECALL finds no selector and reverts).
///
///         Built-in stake trigger (RuleStake): if `_stakeConfig()` returns an amount > 0, popArgs equal to exactly
///         `STAKE_POP_ARGS` (32 bytes) are handled here, never reaching the hooks: the action calls the staking
///         registry's addStake{value: amount}(delay) from the rule contract itself (the registry keys stake by msg.sender).
abstract contract RuleContract is RuleStake {
    /// @dev The logic contract's own address. Under DELEGATECALL address(this) is the rule contract, so equality means a direct call.
    address private immutable __self = address(this);

    /// @dev Transient slot holding the payer during __action (keccak256("popcorn.rule contract.payer")). Only written in SENDER.
    bytes32 private constant PAYER_TSLOT = 0x69f6365a6aa2c9bfacbcc8980295ae9039416fd58403d39f89d9a87bada014e7;

    error DirectCall();
    error ZeroNonceKey();
    error NotImplemented();
    error TriggerDataTooShort(uint256 needed, uint256 length);

    modifier onlyRuleContract() {
        if (address(this) == __self) revert DirectCall();
        _;
    }

    /// @notice For ordinary user functions reached through Core's forward path: reverts when called on the logic
    ///         contract directly (its own storage, not a rule contract's). Core already guarantees it never runs during __action.
    modifier forwarded() {
        if (address(this) == __self) revert DirectCall();
        _;
    }

    // ------------------------------------------------------------------ reserved entry points (core/ABI.md)

    /// @notice Core VERIFY, DELEGATECALL with 10,000 gas. selector 0x97031c8c.
    function __nonceKey(bytes calldata popArgs) external view onlyRuleContract returns (uint256 key) {
        key = _isStakePop(popArgs) ? _stakeNonceKey() : nonceKey(popArgs);
        if (key == 0) revert ZeroNonceKey();
    }

    /// @notice Core VERIFY, DELEGATECALL with conditionGas. selector 0x05f661f0. Must return exactly true.
    function __condition(bytes calldata popArgs, bytes calldata verifyData) external view onlyRuleContract returns (bool) {
        return _isStakePop(popArgs) ? _stakeCondition() : condition(popArgs, verifyData);
    }

    /// @notice Core SENDER, DELEGATECALL with all remaining gas. selector 0x6019566d. payer = who paid the gas
    ///         (rule-pays: the rule contract itself).
    function __action(bytes calldata popArgs, address payer_) external onlyRuleContract {
        assembly ("memory-safe") {
            tstore(PAYER_TSLOT, payer_)
        }
        if (_isStakePop(popArgs)) _stakeAction(payer_);
        else action(popArgs, payer_);
        assembly ("memory-safe") {
            tstore(PAYER_TSLOT, 0)
        }
    }

    /// @notice The nonce key a trigger with these popArgs would consume now, computed in the rule contract's own context
    ///         (its address and storage), exactly as __nonceKey computes it in VERIFY. An ordinary forwarded view, so
    ///         the SDK can read the key with eth_call instead of re-running the logic in a shadow contract, whose
    ///         address would differ (keys derived from address(this) came out wrong that way). msg.sender here is the
    ///         eth_call's sender, not 0xaa. Reverts with ZeroNonceKey like __nonceKey.
    function popcornNonceKey(bytes calldata popArgs) external view forwarded returns (uint256 key) {
        key = _isStakePop(popArgs) ? _stakeNonceKey() : nonceKey(popArgs);
        if (key == 0) revert ZeroNonceKey();
    }

    // ------------------------------------------------------------------ developer hooks (override one form of each)

    /// @notice The one-shot key this trigger consumes; each key triggers at most once (Core requires nonce_seq == 0). Must be
    ///         != 0. Derive it from rule contract state the action advances (see the contract notes), not from popArgs alone.
    function nonceKey(bytes calldata popArgs) internal view virtual returns (uint256) {
        popArgs;
        return nonceKey();
    }

    /// @notice Convenience form: a key that does not depend on popArgs (e.g. keccak256(abi.encode("fire", epoch))).
    function nonceKey() internal view virtual returns (uint256) {
        revert NotImplemented();
    }

    /// @notice True when the trigger should happen. popArgs and verifyData are chosen by whoever builds the trigger: treat them
    ///         as untrusted hints and proofs, never as authorization (rule-pays triggers carry no signature).
    function condition(bytes calldata popArgs, bytes calldata verifyData) internal view virtual returns (bool) {
        popArgs;
        verifyData;
        return condition();
    }

    /// @notice Convenience form: a condition on the rule contract's (or a staked rule contract's target's) state only.
    function condition() internal view virtual returns (bool) {
        revert NotImplemented();
    }

    /// @notice What the trigger does. Runs once per trigger (Core re-entry lock). New storage slots cost 97,920 state gas each
    ///         (maxStateGasPerFrame). A revert here still consumes the key and the rule contract still pays (APPROVE came first).
    function action(bytes calldata popArgs, address payer_) internal virtual {
        popArgs;
        payer_;
        action();
    }

    /// @notice Convenience form.
    function action() internal virtual {
        revert NotImplemented();
    }

    // ------------------------------------------------------------------ helpers

    /// @notice The payer Core passed to __action (rule-pays: the rule contract). address(0) outside __action.
    function _payer() internal view returns (address p) {
        assembly ("memory-safe") {
            p := tload(PAYER_TSLOT)
        }
    }

    /// @notice True while __action runs (SENDER frame of a trigger), false in forwarded calls and in plain calls.
    ///         Uses TLOAD: never call it from nonceKey/condition (VERIFY bans TLOAD).
    function _inAction() internal view returns (bool) {
        return _payer() != address(0);
    }

    /// @notice popArgs word i (bytes [32i, 32i+32)) as uint256; reverts if popArgs is shorter.
    function _word(bytes calldata popArgs, uint256 i) internal pure returns (uint256 v) {
        uint256 end = 32 * i + 32;
        if (popArgs.length < end) revert TriggerDataTooShort(end, popArgs.length);
        assembly ("memory-safe") {
            v := calldataload(add(popArgs.offset, mul(32, i)))
        }
    }

    /// @notice popArgs word i as an address (low 20 bytes; the high 12 must be zero, as in abi.encode).
    function _address(bytes calldata popArgs, uint256 i) internal pure returns (address) {
        uint256 v = _word(popArgs, i);
        if (v >> 160 != 0) revert TriggerDataTooShort(0, popArgs.length);
        return address(uint160(v));
    }

    /// @dev keccak256("popcorn.rule contract.popArgsKey"): domain of _hashKey, so its keys never equal another key family's.
    bytes32 internal constant POP_KEY_DOMAIN = 0x55056ea43886e2b024d1ce6bc907b635741335b51ee6187aed06b8841db2ddcb;

    /// @notice keccak256(POP_KEY_DOMAIN ++ popArgs) as a key. ONLY for popArgs that can be valid once by construction
    ///         (see the contract notes): with an always-true condition it lets anyone make the rule contract pay without limit.
    function _hashKey(bytes calldata popArgs) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(POP_KEY_DOMAIN, popArgs)));
    }

    /// @notice Reads a word of the rule contract's own storage (for conditions on ERC-7201 slots).
    function _sload(bytes32 slot) internal view returns (uint256 v) {
        assembly ("memory-safe") {
            v := sload(slot)
        }
    }

    function _sstore(bytes32 slot, uint256 v) internal {
        assembly ("memory-safe") {
            sstore(slot, v)
        }
    }
}
