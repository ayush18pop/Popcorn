// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "src/interfaces/IVerifier.sol";
import {Payouts} from "src/privacy/Payouts.sol";
import {Flow, IPopcornExplain, FLOW_YES} from "src/rules/Explain.sol";
import {Answer, YES, NO, UNKNOWN, answer} from "src/blocks/Answer.sol";

/// @title StealthVault
/// @notice Receive to a stealth address that nobody can link to you, and spend it without a gas top-up that would.
///         Rule-pays (Core mode 0): the vault is the transaction's sender and payer.
///
///         The problem: a stealth address hides who received a payment, but the receiver must fund it with ETH to move
///         anything, and that funding links it back to them. Stealth addresses built on secp256k1 also lose their
///         privacy to a future quantum computer, which can recompute the shared secret from the recorded announcement.
///
///         Receive (ordinary call): pay(commitment, viewTag, announcement) with any ETH. The payer encapsulated to the
///         receiver's ML-KEM key (in the SDK) and got a shared secret s; commitment = Poseidon(Poseidon(spendSecret), s),
///         where Poseidon(spendSecret) is the receiver's public spending tag. The ML-KEM ciphertext is the announcement;
///         the view tag (one byte of a hash of s) lets the receiver skip most announcements without decapsulating.
///         Spend (trigger):
///           popArgs    = abi.encode(uint256 commitment, address recipient, uint256 fee)
///           verifyData = the Groth16 proof (256 bytes) for circuits/stealth.circom
///           nonceKey   = keccak256(abi.encode(KEY_DOMAIN, commitment)): each payment is spent once, by the protocol
///           condition  = the commitment holds a balance, fee is within [minFee, balance], and the proof verifies for
///                        [commitment, recipient, fee]
///           action     = send balance - fee to the recipient (credited if it refuses ETH)
///
///         Post-quantum where it matters for privacy: the announcement is ML-KEM, so recording it today does not reveal
///         the receiver later. The spend proof is Groth16: zero-knowledge, not post-quantum (a quantum computer could
///         forge a spend, not unmask a receiver).
contract StealthVault is Payouts, IPopcornExplain {
    /// @dev keccak256("popcorn.stealthVault"): balance(commitment) at keccak256(abi.encode(commitment, BASE)).
    bytes32 private constant VAULT = 0x48f3e26583839ac8928e303e9f3e72e168da062935641b4659088f63dfe32202;
    uint256 internal constant R = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    bytes32 internal constant KEY_DOMAIN = keccak256("popcorn.stealthVault.spend");

    IVerifier public immutable verifier;
    uint256 public immutable minFee;
    address internal immutable stakeRegistry;
    uint256 internal immutable stakeAmount;
    uint32 internal immutable stakeDelay;

    /// @notice ERC-5564-style announcement: the receiver scans these.
    event Announcement(uint256 indexed commitment, uint8 viewTag, bytes ciphertext, uint256 amount);
    event Spent(uint256 indexed commitment, address indexed recipient, uint256 amount, uint256 fee);

    error BadCommitment();
    error NothingSent();
    error BadConfig();

    constructor(IVerifier verifier_, uint256 minFee_, address stakeRegistry_, uint256 stakeAmount_, uint32 stakeDelay_) {
        if (address(verifier_) == address(0)) revert BadConfig();
        verifier = verifier_;
        minFee = minFee_;
        stakeRegistry = stakeRegistry_;
        stakeAmount = stakeAmount_;
        stakeDelay = stakeDelay_;
    }

    function _stakeConfig() internal view override returns (address, uint256, uint32) {
        return (stakeRegistry, stakeAmount, stakeDelay);
    }

    function _balanceSlot(uint256 commitment) private pure returns (bytes32) {
        return keccak256(abi.encode(commitment, VAULT));
    }

    /// @notice Pays into a stealth commitment. Several payments to the same commitment add up.
    function pay(uint256 commitment, uint8 viewTag, bytes calldata ciphertext) external payable forwarded {
        if (commitment == 0 || commitment >= R) revert BadCommitment();
        if (msg.value == 0) revert NothingSent();
        _sstore(_balanceSlot(commitment), _sload(_balanceSlot(commitment)) + msg.value);
        emit Announcement(commitment, viewTag, ciphertext, msg.value);
    }

    function balanceOf(uint256 commitment) external view forwarded returns (uint256) {
        return _sload(_balanceSlot(commitment));
    }

    /// @dev Cheap enough for Core's 10,000-gas __nonceKey call: one keccak over two words.
    function nonceKey(bytes calldata popArgs) internal pure override returns (uint256) {
        return uint256(keccak256(abi.encode(KEY_DOMAIN, _word(popArgs, 0))));
    }

    function condition(bytes calldata popArgs, bytes calldata verifyData) internal view override returns (bool) {
        if (popArgs.length != 96) return false;
        uint256 commitment = _word(popArgs, 0);
        address recipient = _address(popArgs, 1);
        uint256 fee = _word(popArgs, 2);
        uint256 bal = _sload(_balanceSlot(commitment));
        if (bal == 0 || recipient == address(0) || fee < minFee || fee > bal) return false;
        return _proofOk(commitment, recipient, fee, verifyData).isYes();
    }

    /// @dev The spend proof against [commitment, recipient, fee]; shared by the condition and the explain view.
    function _proofOk(uint256 commitment, address recipient, uint256 fee, bytes calldata proof) private view returns (Answer) {
        uint256[] memory inputs = new uint256[](3);
        inputs[0] = commitment;
        inputs[1] = uint256(uint160(recipient));
        inputs[2] = fee;
        (bool s, bytes memory ret) = address(verifier).staticcall(abi.encodeCall(IVerifier.verify, (proof, inputs)));
        if (!s || ret.length != 32) return UNKNOWN;
        return abi.decode(ret, (uint256)) == 1 ? YES : NO;
    }

    function action(bytes calldata popArgs, address) internal override {
        uint256 commitment = _word(popArgs, 0);
        address recipient = _address(popArgs, 1);
        uint256 fee = _word(popArgs, 2);
        uint256 bal = _sload(_balanceSlot(commitment));
        _sstore(_balanceSlot(commitment), 0);
        emit Spent(commitment, recipient, bal - fee, fee);
        _sendOrCredit(recipient, bal - fee);
    }

    // ------------------------------------------------------------------ explain (the explorer's flow, same order as condition)

    function popcornExplain(bytes calldata popArgs, bytes calldata verifyData) external view returns (string memory, string memory, bytes memory) {
        bool shaped = popArgs.length == 96 && uint256(bytes32(popArgs[32:64])) >> 160 == 0;
        uint256 c = shaped ? uint256(bytes32(popArgs[0:32])) : 0;
        uint256 bal = _sload(_balanceSlot(c));
        address to = shaped ? address(uint160(uint256(bytes32(popArgs[32:64])))) : address(0);
        uint256 fee = shaped ? uint256(bytes32(popArgs[64:96])) : 0;
        bool fees = bal > 0 && to != address(0) && fee >= minFee && fee <= bal;
        Answer proof = fees ? _proofOk(c, to, fee, verifyData) : NO;
        return (
            "spend",
            "t||Spend: commitment, recipient and fee, with a spend proof|;p|self-paying|the vault pays the gas, out of the payment|0;c||the payment exists and has not been spent|0;c|compare|a recipient is set and the fee is within [minimum fee, payment]|0;c||the spend proof verifies (ZK): the sender owns this payment|0;o|and|AND|2,3,4;a||send the payment minus the fee to the recipient|5",
            abi.encodePacked(Flow.result(answer(shaped)), FLOW_YES, Flow.after_(shaped, answer(bal > 0)), Flow.after_(shaped && bal > 0, answer(fees)), Flow.after_(fees, proof), Flow.result(fees ? proof : NO), Flow.runs(fees && proof.isYes()))
        );
    }
}
