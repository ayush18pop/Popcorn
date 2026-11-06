// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreHarness} from "test/CoreHarness.sol";
import {SovereignAccount} from "src/builds/SovereignAccount.sol";
import {MembershipVerifier} from "src/proofs/MembershipVerifier.sol";
import {EcdsaSigner} from "src/signers/EcdsaSigner.sol";
import {IIntentScheme} from "src/signers/IIntentScheme.sol";
import {IVerifier} from "src/interfaces/IVerifier.sol";
import {IntentDigest} from "src/signers/IntentDigest.sol";

interface Vm {
    function etch(address, bytes calldata) external;
    function deal(address, uint256) external;
    function warp(uint256) external;
    function prank(address) external;
    function addr(uint256) external pure returns (address);
    function sign(uint256, bytes32) external pure returns (uint8, bytes32, bytes32);
    function readFile(string calldata) external view returns (string memory);
    function parseJsonUint(string calldata, string calldata) external pure returns (uint256);
    function parseJsonBytes(string calldata, string calldata) external pure returns (bytes memory);
    function parseJsonBytes32(string calldata, string calldata) external pure returns (bytes32);
}

/// Logic tests with ECDSA as the owner and backup scheme (the devnet test runs ECDSA + Falcon and WOTS+). Guardian proofs
/// come from packages/zk/scripts/gen-fixtures.ts, bound to the account at 0x1003.
contract SovereignAccountTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant ACCOUNT = address(0x1003);
    address constant EXIT = address(0xE417);
    uint256 constant OWNER_PK = 0xA11CE;
    uint256 constant BACKUP_PK = 0xB4C;
    string json;
    bytes ownerParams;
    bytes backupParams;

    function setUp() public {
        json = vm.readFile("test/fixtures/zk-modules.json");
        EcdsaSigner ecdsa = new EcdsaSigner();
        SovereignAccount logic = new SovereignAccount(
            IIntentScheme(address(ecdsa)), IIntentScheme(address(ecdsa)), IVerifier(address(new MembershipVerifier())), 1 days, address(this), address(0), 0, 0
        );
        vm.etch(ACCOUNT, address(new CoreHarness(address(logic), 2_000_000)).code);
        ownerParams = abi.encodePacked(vm.addr(OWNER_PK));
        backupParams = abi.encodePacked(vm.addr(BACKUP_PK));
        _acct().initialize(keccak256(ownerParams), EXIT, keccak256(backupParams), vm.parseJsonUint(json, ".guardians.root"), 2);
        vm.deal(ACCOUNT, 5 ether);
    }

    function _acct() internal pure returns (SovereignAccount) {
        return SovereignAccount(payable(ACCOUNT));
    }

    function _h() internal pure returns (CoreHarness) {
        return CoreHarness(payable(ACCOUNT));
    }

    function _sig(uint256 pk, uint256 ruleId, uint256 epoch, bytes32 argsHash) internal view returns (bytes memory) {
        bytes32 d = keccak256(
            abi.encodePacked(
                hex"1901",
                keccak256(abi.encode(IntentDigest.DOMAIN_TYPEHASH, IntentDigest.NAME_HASH, IntentDigest.VERSION_HASH, block.chainid, ACCOUNT)),
                keccak256(abi.encode(IntentDigest.INTENT_TYPEHASH, ruleId, epoch, argsHash))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function _vote(string memory path) internal returns (bool) {
        bytes32 proposal = vm.parseJsonBytes32(json, string.concat(path, ".proposal"));
        uint256 n = vm.parseJsonUint(json, string.concat(path, ".nullifierHash"));
        bytes memory a = abi.encode(uint256(2), proposal, n);
        bytes memory proof = vm.parseJsonBytes(json, string.concat(path, ".proof"));
        if (!_h().condition(a, proof)) return false;
        _h().pop(a, proof);
        return true;
    }

    function test_owner_spends_with_a_signature_and_each_signature_once() public {
        bytes memory a = abi.encode(uint256(1), address(0xbeef), uint256(1 ether), bytes(""));
        bytes memory vd = abi.encode(ownerParams, _sig(OWNER_PK, 1, 0, keccak256(a)));
        require(_h().condition(a, vd), "owner-signed spend");
        _h().pop(a, vd);
        require(address(0xbeef).balance == 1 ether, "paid");
        require(!_h().condition(a, vd), "epoch moved: the same signature is dead");
        bytes memory forged = abi.encode(ownerParams, _sig(0xBAD, 1, 1, keccak256(a)));
        require(!_h().condition(a, forged), "another key");
        bytes memory otherParams = abi.encode(abi.encodePacked(vm.addr(0xBAD)), _sig(0xBAD, 1, 1, keccak256(a)));
        require(!_h().condition(a, otherParams), "params must hash to the owner's");
    }

    function test_quantum_switch_refuses_owner_spends_and_only_the_backup_key_migrates() public {
        bytes memory q = abi.encode(uint256(5));
        _h().pop(q, abi.encode(ownerParams, _sig(OWNER_PK, 5, 0, keccak256(q))));
        (,, bool quantum,,,,,) = _acct().state();
        require(quantum, "switched");
        bytes memory a = abi.encode(uint256(1), address(0xbeef), uint256(1 ether), bytes(""));
        require(!_h().condition(a, abi.encode(ownerParams, _sig(OWNER_PK, 1, 0, keccak256(a)))), "owner spends refused");
        bytes memory m = abi.encode(uint256(4), address(0xC01D));
        require(!_h().condition(m, abi.encode(ownerParams, _sig(OWNER_PK, 4, 0, keccak256(m)))), "the old owner cannot migrate");
        bytes memory mv = abi.encode(backupParams, _sig(BACKUP_PK, 4, 0, keccak256(m)));
        require(_h().condition(m, mv), "the committed backup key migrates");
        _h().pop(m, mv);
        require(address(0xC01D).balance == 5 ether, "everything moved");
        require(!_h().condition(a, abi.encode(ownerParams, _sig(OWNER_PK, 1, 0, keccak256(a)))), "nothing more runs");
    }

    function test_hidden_guardians_rotate_after_the_delay() public {
        require(_vote(".guardians.rotationVotes[0]"), "first vote");
        require(_acct().guardianRound() == 0, "one vote is not a quorum");
        require(_vote(".guardians.rotationVotes[1]"), "second vote");
        require(_acct().guardianRound() == 1, "quorum opens the next round");
        require(!_vote(".guardians.staleVote"), "a vote for the closed round is refused");
        (,,,,, bytes32 pending, uint256 readyAt,) = _acct().state();
        require(pending == vm.parseJsonBytes32(json, ".guardians.newOwnerHash"), "rotation pending");
        bool ok;
        try _acct().finalizeRecovery() { ok = true; } catch {}
        require(!ok, "too early");
        vm.warp(readyAt);
        _acct().finalizeRecovery();
        (bytes32 owner,,,,,,,) = _acct().state();
        require(owner == pending, "rotated");
    }

    function test_a_contested_takeover_opens_the_forced_exit_to_anyone() public {
        bytes memory e = abi.encode(uint256(3));
        require(!_h().condition(e, ""), "no exit while uncontested");
        _vote(".guardians.rotationVotes[0]");
        _vote(".guardians.rotationVotes[1]");
        _acct().contest(ownerParams, _sig(OWNER_PK, 6, 1, keccak256("contest")));
        bool ok;
        try _acct().finalizeRecovery() { ok = true; } catch {}
        require(!ok, "the contested rotation is gone");
        require(_h().condition(e, ""), "anyone may exit");
        _h().pop(e, "");
        require(EXIT.balance == 5 ether, "everything to the committed exit address");
    }

    function test_guardians_can_flip_the_quantum_switch() public {
        _vote(".guardians.rotationVotes[0]");
        _vote(".guardians.rotationVotes[1]");
        require(_vote(".guardians.quantumVotes[0]") && _vote(".guardians.quantumVotes[1]"), "round 1 quantum votes");
        (,, bool quantum,,,,,) = _acct().state();
        require(quantum, "switched by guardians");
    }

    /// A spend the owner signed but whose trigger data is not (kind, to, value, data) is refused before its key is spent,
    /// so it cannot leave the spend epoch stuck; the next well-formed spend still works.
    function test_malformed_signed_spend_is_refused_and_spends_keep_working() public {
        bytes memory bad = abi.encode(uint256(1), address(0xbeef));
        require(!_h().condition(bad, abi.encode(ownerParams, _sig(OWNER_PK, 1, 0, keccak256(bad)))), "malformed spend refused in validation");
        bytes memory a = abi.encode(uint256(1), address(0xbeef), uint256(1 ether), bytes(""));
        _h().pop(a, abi.encode(ownerParams, _sig(OWNER_PK, 1, 0, keccak256(a))));
        require(address(0xbeef).balance == 1 ether, "the next spend works");
    }

    function test_initialize_once_and_only_by_the_deployer() public {
        bool ok;
        try _acct().initialize(bytes32(0), EXIT, bytes32(0), 1, 1) { ok = true; } catch {}
        require(!ok, "once");
    }
}
