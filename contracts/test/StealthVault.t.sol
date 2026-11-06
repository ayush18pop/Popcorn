// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ExplainCheck} from "test/ExplainCheck.sol";

import {CoreHarness} from "test/CoreHarness.sol";
import {StealthVault} from "src/privacy/StealthVault.sol";
import {StealthVerifier} from "src/proofs/StealthVerifier.sol";
import {IVerifier} from "src/interfaces/IVerifier.sol";

interface Vm {
    function etch(address, bytes calldata) external;
    function deal(address, uint256) external;
    function readFile(string calldata) external view returns (string memory);
    function parseJsonUint(string calldata, string calldata) external pure returns (uint256);
    function parseJsonBytes(string calldata, string calldata) external pure returns (bytes memory);
}

/// Proof from packages/zk/scripts/gen-fixtures.ts: spendSecret 4242, shared 777, recipient 0xbeef, fee 0.001 ether.
contract StealthVaultTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant VAULT = address(0x1002);
    address constant RECIPIENT = address(0xbeef);
    string json;
    uint256 commitment;
    uint256 fee;
    bytes proof;

    function setUp() public {
        json = vm.readFile("test/fixtures/zk-modules.json");
        commitment = vm.parseJsonUint(json, ".stealth.commitment");
        fee = vm.parseJsonUint(json, ".fee");
        proof = vm.parseJsonBytes(json, ".stealth.proof");
        StealthVault logic = new StealthVault(IVerifier(address(new StealthVerifier())), 0.0001 ether, address(0), 0, 0);
        vm.etch(VAULT, address(new CoreHarness(address(logic), 300_000)).code);
        vm.deal(address(this), 10 ether);
    }

    function test_pay_announce_and_spend_once() public {
        StealthVault(payable(VAULT)).pay{value: 2 ether}(commitment, 0x5a, hex"c0ffee");
        StealthVault(payable(VAULT)).pay{value: 1 ether}(commitment, 0x5a, hex"c0ffee");
        require(StealthVault(payable(VAULT)).balanceOf(commitment) == 3 ether, "payments add up");
        bytes memory a = abi.encode(commitment, RECIPIENT, fee);
        CoreHarness h = CoreHarness(payable(VAULT));
        require(ExplainCheck.cond(h, a, proof), "the receiver's proof");
        h.pop(a, proof);
        require(RECIPIENT.balance == 3 ether - fee, "balance - fee to the recipient");
        require(StealthVault(payable(VAULT)).balanceOf(commitment) == 0, "emptied");
        require(!ExplainCheck.cond(h, a, proof), "nothing left to spend");
    }

    function test_refusals() public {
        CoreHarness h = CoreHarness(payable(VAULT));
        require(!ExplainCheck.cond(h, abi.encode(commitment, RECIPIENT, fee), proof), "empty commitment");
        StealthVault(payable(VAULT)).pay{value: 1 ether}(commitment, 1, "");
        require(!ExplainCheck.cond(h, abi.encode(commitment, address(0xdead), fee), proof), "recipient bound");
        require(!ExplainCheck.cond(h, abi.encode(commitment, RECIPIENT, fee + 1), proof), "fee bound");
        require(!ExplainCheck.cond(h, abi.encode(commitment, RECIPIENT, uint256(1)), proof), "below the minimum fee");
        require(!ExplainCheck.cond(h, abi.encode(commitment + 1, RECIPIENT, fee), proof), "another commitment");
        bool ok;
        try StealthVault(payable(VAULT)).pay{value: 0}(commitment, 1, "") { ok = true; } catch {}
        require(!ok, "zero payment refused");
    }
}
