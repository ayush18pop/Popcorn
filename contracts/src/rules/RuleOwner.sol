// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title RuleOwner (built into RuleContract)
/// @notice The logic side of Core's hybrid owner path (core/LAYOUT.md "OWNER").
///
///         A rule contract deployed with an owner (ECDSA address + WOTS+ root + public seed, set by the factory) accepts ONE kind of
///         owner-authorised transaction: the frame tx [VERIFY, SENDER ownerBump(), SENDER owner(bytes call)], approved by
///         Core only if the sig hash carries a valid ECDSA signature AND a valid WOTS+ signature of the owner. Core then
///         DELEGATECALLs `call` on this logic with a transient FLAG set (OWNER_FLAG_TSLOT); `msg.sender` is the rule contract.
///
///         Owner functions are ordinary external functions guarded by `onlyOwnerCall`:
///           - a normal call (forward path) or a trigger's `__action` never has the flag, so it reverts NotOwnerCall;
///           - Core sets the flag only inside the owner frame and clears it right after; the SENDER lock is held for that
///             time, so nothing can re-enter the rule contract meanwhile (forwarded calls get 0x39, triggers 0x37);
///           - Core refuses calls to the reserved selectors, so `call` can never be __action / trigger / owner itself.
///
///         The owner's authority is total over the rule contract's logic: everything here (rotation, ETH withdrawal, stake) is
///         one-way trust in the two signatures. ETH leaves the rule contract only through the notice-gated withdraw below.
///
///         State (Core's namespace, written by Core's constructor and bump frame, core/LAYOUT.md; BASE+3..+5 = a staged rotation): slot BASE = ecdsa
///         (bits 0..159) | wotsIndex << 160, BASE+1 = wotsRoot, BASE+2 = wotsPubSeed. The notice-gated withdraw lives in this
///         contract's own namespaced slots (ERC-7201 style), below.
abstract contract RuleOwner {
    /// @dev keccak256("popcorn.core.owner"): Core's owner slots (slot 0 ecdsa|wotsIndex<<160, +1 root, +2 pubSeed).
    bytes32 internal constant OWNER_BASE = 0x6c5153798c380854dc793bae6a86335313b83f008f4ecf20cd663a8aa18e7c27;
    /// @dev keccak256("popcorn.core.ownercall"): transient, 1 while Core runs an owner call.
    bytes32 internal constant OWNER_FLAG_TSLOT = 0x4257847a835ea5fd0672322af0942e7be8da7acf8d7dedb7dd4ccbeeb6bdf7bf;
    /// @dev Core's pending-owner slots: OWNER_BASE + 3 (ecdsa | index << 160), +4 root, +5 pubSeed.
    bytes32 internal constant PENDING_BASE = bytes32(uint256(OWNER_BASE) + 3);
    /// @dev keccak256("popcorn.rule contract.ownerwithdraw"): +0 to (address), +1 amount, +2 readyAt (0 = none pending).
    bytes32 internal constant WITHDRAW_BASE = 0x555ad4bd5abb695f5b63a7048866742907cf65871d57f4f840247f9fe0ed8471;

    event OwnerRotationStaged(address indexed ecdsa, bytes32 wotsRoot, bytes32 wotsPubSeed);
    event OwnerRotated(address indexed ecdsa, bytes32 wotsRoot, bytes32 wotsPubSeed);
    event OwnerRotationCancelled();
    event OwnerWithdrawStarted(address indexed to, uint256 amount, uint256 readyAt);
    event OwnerWithdrawCancelled(address indexed to, uint256 amount);
    event OwnerWithdrawFinished(address indexed to, uint256 amount);

    error NotOwnerCall();
    error OwnerRotationInvalid();
    error NoPendingRotation();
    error OwnerNoPendingWithdraw();
    error OwnerWithdrawPending();
    error OwnerWithdrawNotReady(uint256 readyAt, uint256 nowTs);
    error OwnerWithdrawFailed();
    error OwnerWithdrawAmountInvalid(uint256 amount, uint256 balance);

    /// @notice Only inside Core's owner frame (both owner signatures were checked in VERIFY). Never true in a trigger, a
    ///         forwarded call, VERIFY or a direct call on the logic contract.
    modifier onlyOwnerCall() {
        if (!_ownerCallActive()) revert NotOwnerCall();
        _;
    }

    /// @notice Notice period of `ownerStartWithdraw` (seconds). Override with an immutable; default one day.
    function _withdrawNotice() internal view virtual returns (uint256) {
        return 1 days;
    }

    /// @notice True while Core runs an owner call. Uses TLOAD: never call it from nonceKey/condition (VERIFY bans TLOAD).
    function _ownerCallActive() internal view returns (bool a) {
        bytes32 f = OWNER_FLAG_TSLOT;
        assembly ("memory-safe") {
            a := tload(f)
        }
    }

    // ------------------------------------------------------------------ owner state (views for the rule contract's own use)

    function _ownerEcdsa() internal view returns (address a) {
        return address(uint160(_oLoad(OWNER_BASE)));
    }

    /// @notice First WOTS leaf the next owner tx may use (Core's bump sets it to leaf + 1).
    function _ownerWotsIndex() internal view returns (uint256) {
        return _oLoad(OWNER_BASE) >> 160;
    }

    function _ownerWotsRoot() internal view returns (bytes32) {
        return bytes32(_oLoad(bytes32(uint256(OWNER_BASE) + 1)));
    }

    function _ownerWotsPubSeed() internal view returns (bytes32) {
        return bytes32(_oLoad(bytes32(uint256(OWNER_BASE) + 2)));
    }

    function _oLoad(bytes32 slot) private view returns (uint256 v) {
        assembly ("memory-safe") {
            v := sload(slot)
        }
    }

    function _oStore(bytes32 slot, uint256 v) private {
        assembly ("memory-safe") {
            sstore(slot, v)
        }
    }

    // ------------------------------------------------------------------ owner functions

    /// @notice STAGES a new owner (ECDSA key + WOTS tree). Nothing changes yet: the current keys stay valid until a tx signed by
    ///         the NEW keys calls `ownerFinalizeRotation()` (Core verifies that one call against the pending slots), so a typo'd
    ///         root, a wrong public seed or an ECDSA address nobody controls cannot lock the owner out; `ownerCancelRotation()`
    ///         drops it. The new tree must differ from the active and the pending one (SDK: also from every tree used before).
    function ownerRotate(address ecdsa, bytes32 wotsRoot, bytes32 wotsPubSeed) external onlyOwnerCall {
        if (ecdsa == address(0) || ecdsa.code.length != 0 || wotsRoot == bytes32(0) || wotsPubSeed == bytes32(0)) revert OwnerRotationInvalid();
        if (wotsRoot == _ownerWotsRoot() || wotsPubSeed == _ownerWotsPubSeed()) revert OwnerRotationInvalid();
        _oStore(PENDING_BASE, uint256(uint160(ecdsa))); // pending wotsIndex = 0
        _oStore(bytes32(uint256(PENDING_BASE) + 1), uint256(wotsRoot));
        _oStore(bytes32(uint256(PENDING_BASE) + 2), uint256(wotsPubSeed));
        emit OwnerRotationStaged(ecdsa, wotsRoot, wotsPubSeed);
    }

    /// @notice Runs ONLY in a tx Core verified against the pending keys (selector 0x13077cfd): promotes pending to active,
    ///         carrying the pending tree's index (its bump frame already spent the leaf of this very tx).
    function ownerFinalizeRotation() external onlyOwnerCall {
        uint256 p0 = _oLoad(PENDING_BASE);
        if (p0 & type(uint160).max == 0) revert NoPendingRotation();
        _oStore(OWNER_BASE, p0);
        _oStore(bytes32(uint256(OWNER_BASE) + 1), _oLoad(bytes32(uint256(PENDING_BASE) + 1)));
        _oStore(bytes32(uint256(OWNER_BASE) + 2), _oLoad(bytes32(uint256(PENDING_BASE) + 2)));
        _clearPending();
        emit OwnerRotated(address(uint160(p0)), _ownerWotsRoot(), _ownerWotsPubSeed());
    }

    /// @notice Drops a staged rotation (signed by the CURRENT keys).
    function ownerCancelRotation() external onlyOwnerCall {
        if (_oLoad(PENDING_BASE) & type(uint160).max == 0) revert NoPendingRotation();
        _clearPending();
        emit OwnerRotationCancelled();
    }

    function _clearPending() private {
        _oStore(PENDING_BASE, 0);
        _oStore(bytes32(uint256(PENDING_BASE) + 1), 0);
        _oStore(bytes32(uint256(PENDING_BASE) + 2), 0);
    }

    /// @notice The staged owner (ecdsa, wotsRoot, wotsPubSeed, wotsIndex); ecdsa 0 = none. Forwarded view.
    function pendingOwner() external view returns (address ecdsa, bytes32 wotsRoot, bytes32 wotsPubSeed, uint256 wotsIndex) {
        uint256 p0 = _oLoad(PENDING_BASE);
        return (address(uint160(p0)), bytes32(_oLoad(bytes32(uint256(PENDING_BASE) + 1))), bytes32(_oLoad(bytes32(uint256(PENDING_BASE) + 2))), p0 >> 160);
    }

    /// @notice Announces a withdrawal of `amount` wei of the rule contract's ETH to `to`; it can be finished after the notice period
    ///         (`block.timestamp`, read in the owner frame's execution). The rule contract's ETH pays for its own triggers (rule-pays),
    ///         so a watcher gets the notice period to react to a withdrawal it did not expect.
    function ownerStartWithdraw(address payable to, uint256 amount) external onlyOwnerCall {
        if (_oLoad(bytes32(uint256(WITHDRAW_BASE) + 2)) != 0) revert OwnerWithdrawPending();
        if (to == address(0) || amount == 0 || amount > address(this).balance) revert OwnerWithdrawAmountInvalid(amount, address(this).balance);
        uint256 readyAt = block.timestamp + _withdrawNotice();
        _oStore(WITHDRAW_BASE, uint256(uint160(address(to))));
        _oStore(bytes32(uint256(WITHDRAW_BASE) + 1), amount);
        _oStore(bytes32(uint256(WITHDRAW_BASE) + 2), readyAt);
        emit OwnerWithdrawStarted(to, amount, readyAt);
    }

    /// @notice Sends the announced ETH once the notice period has passed. Reverts before (the owner frame reverts, the
    ///         WOTS leaf stays spent: Core's bump frame commits on its own).
    function ownerFinishWithdraw() external onlyOwnerCall {
        uint256 readyAt = _oLoad(bytes32(uint256(WITHDRAW_BASE) + 2));
        if (readyAt == 0) revert OwnerNoPendingWithdraw();
        if (block.timestamp < readyAt) revert OwnerWithdrawNotReady(readyAt, block.timestamp);
        address to = address(uint160(_oLoad(WITHDRAW_BASE)));
        uint256 amount = _oLoad(bytes32(uint256(WITHDRAW_BASE) + 1));
        _oStore(WITHDRAW_BASE, 0);
        _oStore(bytes32(uint256(WITHDRAW_BASE) + 1), 0);
        _oStore(bytes32(uint256(WITHDRAW_BASE) + 2), 0);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert OwnerWithdrawFailed();
        emit OwnerWithdrawFinished(to, amount);
    }

    /// @notice Drops a pending withdrawal.
    function ownerCancelWithdraw() external onlyOwnerCall {
        if (_oLoad(bytes32(uint256(WITHDRAW_BASE) + 2)) == 0) revert OwnerNoPendingWithdraw();
        address to = address(uint160(_oLoad(WITHDRAW_BASE)));
        uint256 amount = _oLoad(bytes32(uint256(WITHDRAW_BASE) + 1));
        _oStore(WITHDRAW_BASE, 0);
        _oStore(bytes32(uint256(WITHDRAW_BASE) + 1), 0);
        _oStore(bytes32(uint256(WITHDRAW_BASE) + 2), 0);
        emit OwnerWithdrawCancelled(to, amount);
    }

    /// @notice The announced withdrawal (to, amount, readyAt); readyAt 0 = none. Forwarded view.
    function pendingWithdraw() external view returns (address to, uint256 amount, uint256 readyAt) {
        return (address(uint160(_oLoad(WITHDRAW_BASE))), _oLoad(bytes32(uint256(WITHDRAW_BASE) + 1)), _oLoad(bytes32(uint256(WITHDRAW_BASE) + 2)));
    }
}
