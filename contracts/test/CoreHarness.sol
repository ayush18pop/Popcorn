// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title CoreHarness
/// @notice A plain contract that calls a rule contract logic exactly the way Popcorn Core does, so rule contract logic is unit-testable
///         in Foundry without EIP-8141. It plays the rule contract: logic runs by DELEGATECALL in THIS contract's storage,
///         balance and address, like it runs in a Core deployment.
///
///         Same as Core (core/PopcornCore.yul, core/ABI.md):
///           __nonceKey  : DELEGATECALL, 10,000 gas, calldata = 0x97031c8c ++ abi.encode(popArgs); 32-byte non-zero word
///           __condition : DELEGATECALL, exactly `conditionGas`, calldata = abi.encodeCall(__condition, (popArgs, verifyData));
///                         valid only if it returns exactly the word 1
///           __action    : DELEGATECALL, all gas, calldata = abi.encodeCall(__action, (popArgs, payer = address(this)));
///                         revert bubbled; a transient lock makes a re-entering pop(bytes) call revert with word 0x37;
///                         any other self-call (a forwarded function calling address(this)) reverts 0x3b
///           each key triggers once (nonce_seq == 0): `trigger` refuses a used key
///           forward path: any other call with >= 4 bytes of calldata is DELEGATECALLed to logic with all gas,
///           value kept, return/revert bubbled; refused with word 0x3a (< 4 bytes), 0x38 (reserved selector), 0x39
///           (while __action runs). The harness's own public functions shadow logic selectors of the same name.
///           max_cost reservation (setMaxCost): ethrex debits the trigger's whole max_cost from the rule contract at APPROVE and
///           refunds the unused part after the frames, so during the action the rule contract holds balance - max_cost. `trigger`
///           moves max_cost to a Reserve before the action and takes it back after (no actual charge is modelled);
///           a balance below max_cost makes the trigger invalid (InvalidPop(0x00); on chain APPROVE reverts).
///           caller-pays (mode 1): `popCallerPays(popArgs, verifyData, payer)` = the same key/condition/once
///           rules, then __action(popArgs, payer) with the payer given (on chain: FRAMEPARAM(target, 1), the payer's
///           VERIFY frame); no max_cost reservation from the rule contract (the payer pays). `actionAs(popArgs, payer)` is the
///           SENDER step alone.
///         Not modelled: frame shapes, fees, caps, the VERIFY floor, banned opcodes and storage rules (devnet only).
///
///         The harness keeps its own state only in namespaced slots and immutables, so logic storage cannot collide.
contract CoreHarness {
    address public immutable logic;
    uint256 public immutable conditionGas;

    uint256 public constant NONCE_KEY_GAS = 10_000;
    bytes4 internal constant SEL_POP = 0xd9292504;
    bytes4 internal constant SEL_NONCE_KEY = 0x97031c8c;
    bytes4 internal constant SEL_CONDITION = 0x05f661f0;
    bytes4 internal constant SEL_ACTION = 0x6019566d;
    bytes4 internal constant SEL_OWNER = 0xbd27b241;
    bytes4 internal constant SEL_OWNER_BUMP = 0x91b5d060;
    /// @dev Core's owner flag slot keccak256("popcorn.core.ownercall") (transient)
    bytes32 internal constant OWNER_FLAG = 0x4257847a835ea5fd0672322af0942e7be8da7acf8d7dedb7dd4ccbeeb6bdf7bf;
    /// @dev keccak256("popcorn.harness.usedKeys"): mapping(uint256 key => bool)
    bytes32 internal constant USED_KEYS = 0xf258466f099f292458678fa97cff412e0ec4e560ae63d1105828a5ef1b87b60c;
    /// @dev Core's lock slot keccak256("popcorn.core.lock") (transient)
    bytes32 internal constant LOCK_SLOT = 0x9dd81f995770cdac1e5604925d6a5e0e08886ca48a9ea18085a511ab38ae2d13;

    /// @dev keccak256("popcorn.harness.maxCost")
    bytes32 internal constant MAX_COST = 0xc80da3f0e1526d072794934da282b324943285e634ca96d7559c5dc6d1885acd;

    error InvalidPop(uint8 code); // Core's error code, e.g. 0x1b/0x1c/0x1d/0x1f/0x20/0x21/0x22

    constructor(address logic_, uint256 conditionGas_) payable {
        logic = logic_;
        conditionGas = conditionGas_;
    }

    // ------------------------------------------------------------------ the three calls, as Core makes them

    /// @notice (ok, key) as VERIFY step 3 sees it.
    function nonceKey(bytes calldata popArgs) public returns (bool ok, uint256 key) {
        bytes memory data = abi.encodeWithSelector(SEL_NONCE_KEY, popArgs);
        bytes memory ret;
        (ok, ret) = logic.delegatecall{gas: NONCE_KEY_GAS}(data);
        if (ok && ret.length == 32) key = abi.decode(ret, (uint256));
        else ok = false;
    }

    /// @notice True iff VERIFY step 4 would approve: the call succeeded and returned exactly the word 1.
    function condition(bytes calldata popArgs, bytes calldata verifyData) public returns (bool) {
        (bool ok, bytes memory ret) = logic.delegatecall{gas: conditionGas}(abi.encodeWithSelector(SEL_CONDITION, popArgs, verifyData));
        return ok && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
    }

    /// @notice The SENDER step: __action(popArgs, payer = this), with Core's re-entry lock.
    function action(bytes calldata popArgs) public returns (bytes memory) {
        return _action(popArgs);
    }

    /// @notice The SENDER step of a caller-pays trigger: __action(popArgs, payer), with the re-entry lock.
    function actionAs(bytes calldata popArgs, address payer) public returns (bytes memory) {
        return _actionAs(popArgs, payer);
    }

    /// @notice A whole caller-pays trigger (Core mode 1): key, condition, then __action with `payer`. Reverts
    ///         InvalidPop(code) where Core's VERIFY would make the tx invalid. The rule contract's balance is not touched.
    function popCallerPays(bytes calldata popArgs, bytes calldata verifyData, address payer) external returns (uint256 key) {
        bool ok;
        (ok, key) = nonceKey(popArgs);
        if (!ok) revert InvalidPop(0x1b);
        if (key == 0) revert InvalidPop(0x1d);
        if (usedKey(key)) revert InvalidPop(0x1f);
        if (!condition(popArgs, verifyData)) revert InvalidPop(0x22);
        _setUsed(key);
        (bool s,) = address(this).call(abi.encodeCall(this.actionAs, (popArgs, payer)));
        s;
    }

    /// @notice A whole trigger: key (non-zero, unused), condition, then action. Reverts InvalidPop(code) where Core's VERIFY
    ///         would make the tx invalid (nothing paid, key not consumed). Returns the key consumed.
    function pop(bytes calldata popArgs, bytes calldata verifyData) external returns (uint256 key) {
        bool ok;
        (ok, key) = nonceKey(popArgs);
        if (!ok) revert InvalidPop(0x1b);
        if (key == 0) revert InvalidPop(0x1d);
        if (usedKey(key)) revert InvalidPop(0x1f);
        if (!condition(popArgs, verifyData)) revert InvalidPop(0x22);
        uint256 mc = maxCost();
        if (address(this).balance < mc) revert InvalidPop(0x00); // APPROVE: the payer cannot cover max_cost
        _setUsed(key);
        Reserve r;
        if (mc > 0) r = new Reserve{value: mc}();
        // As on chain: once VERIFY approved, the key is consumed even if the action reverts.
        (bool s,) = address(this).call(abi.encodeCall(this.action, (popArgs)));
        s;
        if (mc > 0) r.refund();
    }

    /// @notice Sets the max_cost the next triggers reserve (e.g. RuleCosts.maxCostPerTrigger of the rule contract's args).
    function setMaxCost(uint256 mc) external {
        bytes32 slot = MAX_COST;
        assembly ("memory-safe") {
            sstore(slot, mc)
        }
    }

    function maxCost() public view returns (uint256 mc) {
        bytes32 slot = MAX_COST;
        assembly ("memory-safe") {
            mc := sload(slot)
        }
    }

    function usedKey(uint256 key) public view returns (bool u) {
        bytes32 slot = keccak256(abi.encode(key, USED_KEYS));
        assembly ("memory-safe") {
            u := sload(slot)
        }
    }

    /// @notice The owner call frame of Core (senderOwnerCall): DELEGATECALL `call` on the logic with the owner flag and
    ///         the SENDER lock set, revert bubbled (flag and lock revert with it). The harness does NOT check signatures: the
    ///         tests of this function are about the logic's `onlyOwnerCall` functions; Core's VERIFY is tested on the devnet.
    ///         Refuses the reserved selectors like Core's VERIFY (0x55).
    function ownerCall(bytes calldata call) external returns (bytes memory ret) {
        if (call.length < 4) _code(0x54);
        bytes4 sel = bytes4(call);
        if (sel == SEL_POP || sel == SEL_NONCE_KEY || sel == SEL_CONDITION || sel == SEL_ACTION || sel == SEL_OWNER || sel == SEL_OWNER_BUMP) _code(0x55);
        bytes32 l = LOCK_SLOT;
        bytes32 f = OWNER_FLAG;
        bool locked;
        assembly ("memory-safe") {
            locked := tload(l)
        }
        if (locked) _code(0x37);
        assembly ("memory-safe") {
            tstore(l, 1)
            tstore(f, 1)
        }
        bool ok;
        (ok, ret) = logic.delegatecall(call);
        assembly ("memory-safe") {
            tstore(f, 0)
        }
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        assembly ("memory-safe") {
            tstore(l, 0)
        }
    }

    // ------------------------------------------------------------------ inspection

    function load(bytes32 slot) external view returns (uint256 v) {
        assembly ("memory-safe") {
            v := sload(slot)
        }
    }

    // ------------------------------------------------------------------ Core's dispatch for calls from the logic itself

    /// @dev Empty calldata: accept ETH (receive, Core line 181). pop(bytes) from self: SENDER routine again, refused by the lock.
    receive() external payable {}

    fallback() external payable {
        if (msg.data.length == 0) return;
        if (msg.sender == address(this)) {
            // Core SENDER routine for a self-call: inside this rule contract's own trigger (the harness's pop() → action, lock
            // set) the lock answers 0x37; anywhere else (a forwarded function calling address(this), in no trigger of this
            // rule contract) tx.sender is not the rule contract: 0x3b. The harness never runs __action for a self-call.
            bool locked;
            bytes32 l = LOCK_SLOT;
            assembly ("memory-safe") {
                locked := tload(l)
            }
            _code(locked ? 0x37 : 0x3b);
        }
        _forward();
    }

    /// @dev Core forward path.
    function _forward() internal {
        if (msg.data.length < 4) _code(0x3a);
        bytes4 sel = bytes4(msg.data);
        if (sel == SEL_POP || sel == SEL_NONCE_KEY || sel == SEL_CONDITION || sel == SEL_ACTION || sel == SEL_OWNER || sel == SEL_OWNER_BUMP) _code(0x38);
        bytes32 l = LOCK_SLOT;
        bool locked;
        assembly ("memory-safe") {
            locked := tload(l)
        }
        if (locked) _code(0x39);
        address lg = logic;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), lg, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }

    function _code(uint256 c) internal pure {
        assembly ("memory-safe") {
            mstore(0, c)
            revert(0, 32)
        }
    }

    function _action(bytes memory popArgs) internal returns (bytes memory ret) {
        return _actionAs(popArgs, address(this));
    }

    function _actionAs(bytes memory popArgs, address payer) internal returns (bytes memory ret) {
        bool locked;
        bytes32 l = LOCK_SLOT;
        assembly ("memory-safe") {
            locked := tload(l)
        }
        if (locked) {
            assembly ("memory-safe") {
                mstore(0, 0x37)
                revert(0, 32)
            }
        }
        assembly ("memory-safe") {
            tstore(l, 1)
        }
        bool ok;
        (ok, ret) = logic.delegatecall(abi.encodeWithSelector(SEL_ACTION, popArgs, payer));
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        assembly ("memory-safe") {
            tstore(l, 0)
        }
    }

    function _setUsed(uint256 key) internal {
        bytes32 slot = keccak256(abi.encode(key, USED_KEYS));
        assembly ("memory-safe") {
            sstore(slot, 1)
        }
    }
}

/// @notice Holds a trigger's max_cost reservation while the action runs, then returns it to the rule contract (harness).
contract Reserve {
    address payable private immutable ruleContract = payable(msg.sender);

    constructor() payable {}

    function refund() external {
        (bool ok,) = ruleContract.call{value: address(this).balance}("");
        require(ok, "refund");
    }
}
