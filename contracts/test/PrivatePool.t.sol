// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreHarness} from "test/CoreHarness.sol";
import {PrivatePool} from "src/privacy/PrivatePool.sol";
import {IPoseidon2} from "src/privacy/IPoseidon.sol";
import {WithdrawVerifier} from "src/proofs/WithdrawVerifier.sol";
import {IVerifier} from "src/interfaces/IVerifier.sol";

interface Vm {
    function prank(address) external;
    function etch(address, bytes calldata) external;
    function deal(address, uint256) external;
    function readFile(string calldata) external view returns (string memory);
    function parseJsonUint(string calldata, string calldata) external pure returns (uint256);
    function parseJsonUintArray(string calldata, string calldata) external pure returns (uint256[] memory);
    function parseJsonBytes(string calldata, string calldata) external pure returns (bytes memory);
}

contract Refuser {
    receive() external payable {
        revert("no");
    }
}

/// Proofs come from packages/zk/scripts/gen-fixtures.ts, bound to the pool at 0x1001 (scope) and the recipient 0xbeef.
contract PrivatePoolTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant POOL = address(0x1001);
    address constant PROVIDER = address(0xA550C);
    address constant RECIPIENT = address(0xbeef);
    uint256 constant DENOM = 1 ether;

    string json;
    IPoseidon2 poseidon;
    WithdrawVerifier verifier;
    PrivatePool logic;
    uint256 fee;

    function setUp() public {
        json = vm.readFile("test/fixtures/zk-modules.json");
        poseidon = IPoseidon2(_deployPoseidon());
        verifier = new WithdrawVerifier();
        fee = vm.parseJsonUint(json, ".fee");
        logic = new PrivatePool(IVerifier(address(verifier)), poseidon, DENOM, 0.001 ether, PROVIDER, address(0), 0, 0);
        CoreHarness h = new CoreHarness(address(logic), 300_000);
        vm.etch(POOL, address(h).code);
        vm.deal(address(this), 10 ether);
    }

    function _deployPoseidon() internal returns (address a) {
        bytes memory initcode = vm.parseJsonBytes(string.concat("{\"c\":\"", vm.readFile("test/fixtures/poseidon2.hex"), "\"}"), ".c");
        assembly {
            a := create(0, add(initcode, 0x20), mload(initcode))
        }
        require(a != address(0), "poseidon deploy");
    }

    function _pool() internal pure returns (PrivatePool) {
        return PrivatePool(payable(POOL));
    }

    function _deposits() internal {
        uint256[] memory c = vm.parseJsonUintArray(json, ".pool.commitments");
        for (uint256 i = 0; i < c.length; i++) _pool().deposit{value: DENOM}(c[i]);
    }

    function _args(uint256 assocRoot, address to, uint256 f) internal view returns (bytes memory) {
        return abi.encode(vm.parseJsonUint(json, ".pool.nullifierHash"), vm.parseJsonUint(json, ".pool.root"), assocRoot, to, f);
    }

    function test_poseidon_matches_circomlib() public view {
        require(poseidon.poseidon([uint256(1), uint256(2)]) == vm.parseJsonUint(json, ".poseidonCheck"), "poseidon(1,2)");
    }

    function test_tree_root_matches_the_off_chain_tree() public {
        require(_pool().currentRoot() == vm.parseJsonUint(json, ".emptyRoot"), "empty root");
        _deposits();
        require(_pool().currentRoot() == vm.parseJsonUint(json, ".pool.root"), "root after three deposits");
        require(_pool().leafCount() == 3, "count");
        require(_pool().isKnownRoot(vm.parseJsonUint(json, ".pool.root")), "known");
    }

    function test_withdraw_pays_the_recipient_and_spends_the_nullifier() public {
        _deposits();
        uint256 assoc = vm.parseJsonUint(json, ".pool.assocRoot");
        vm.prank(PROVIDER);
        _pool().setAssociationRoot(assoc, true);
        bytes memory proof = vm.parseJsonBytes(json, ".pool.proof");
        bytes memory a = _args(assoc, RECIPIENT, fee);
        CoreHarness h = CoreHarness(payable(POOL));
        require(h.condition(a, proof), "valid withdrawal");
        (bool ok, uint256 key) = h.nonceKey(a);
        require(ok && key == vm.parseJsonUint(json, ".pool.nullifierHash"), "nullifier is the nonce key");
        h.pop(a, proof);
        require(RECIPIENT.balance == DENOM - fee, "recipient paid denomination - fee");
        require(h.usedKey(key), "the nullifier is spent");
        bool replay;
        try h.pop(a, proof) { replay = true; } catch {}
        require(!replay, "a second spend is refused");
    }

    function test_refusals() public {
        _deposits();
        uint256 assoc = vm.parseJsonUint(json, ".pool.assocRoot");
        bytes memory proof = vm.parseJsonBytes(json, ".pool.proof");
        CoreHarness h = CoreHarness(payable(POOL));
        require(!h.condition(_args(assoc, RECIPIENT, fee), proof), "association root not accepted yet");
        vm.prank(PROVIDER);
        _pool().setAssociationRoot(assoc, true);
        require(!h.condition(_args(assoc, address(0xdead), fee), proof), "recipient is bound to the proof");
        require(!h.condition(_args(assoc, RECIPIENT, fee + 1), proof), "fee is bound to the proof");
        require(!h.condition(_args(assoc, RECIPIENT, 0), proof), "below the minimum fee");
        uint256 outside = vm.parseJsonUint(json, ".pool.outsideAssocRoot");
        vm.prank(PROVIDER);
        _pool().setAssociationRoot(outside, true);
        require(!h.condition(_args(outside, RECIPIENT, fee), proof), "a set without this deposit");
        bytes memory bad = proof;
        bad[40] = bytes1(uint8(bad[40]) ^ 1);
        require(!h.condition(_args(assoc, RECIPIENT, fee), bad), "tampered proof");
        vm.prank(PROVIDER);
        _pool().setAssociationRoot(assoc, false);
        require(!h.condition(_args(assoc, RECIPIENT, fee), proof), "a withdrawn association root");
    }

    function test_only_the_provider_publishes_association_roots_and_deposits_are_exact() public {
        bool ok;
        try _pool().setAssociationRoot(1, true) { ok = true; } catch {}
        require(!ok, "not the provider");
        try _pool().deposit{value: 0.5 ether}(1) { ok = true; } catch {}
        require(!ok, "wrong denomination");
    }

    function test_a_refusing_recipient_is_credited_not_lost() public {
        _deposits();
        uint256 assoc = vm.parseJsonUint(json, ".pool.assocRoot");
        vm.prank(PROVIDER);
        _pool().setAssociationRoot(assoc, true);
        Refuser r = new Refuser();
        vm.etch(RECIPIENT, address(r).code);
        CoreHarness(payable(POOL)).pop(_args(assoc, RECIPIENT, fee), vm.parseJsonBytes(json, ".pool.proof"));
        require(_pool().owed(RECIPIENT) == DENOM - fee, "credited");
    }
}
