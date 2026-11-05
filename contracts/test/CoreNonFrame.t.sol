// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AlwaysTrueRule} from "src/mocks/AlwaysTrueRule.sol";
import {ForwardRule} from "src/mocks/ForwardRule.sol";
import {Bouncer} from "src/mocks/Bouncer.sol";
import {RuleContract} from "src/rules/RuleContract.sol";

interface Vm {
    function readFile(string calldata) external view returns (string memory);
    function parseBytes(string calldata) external pure returns (bytes memory);
    function load(address, bytes32) external view returns (bytes32);
    function deal(address, uint256) external;
    function prank(address) external;
}

/// Core paths that never reach a frame opcode: deploy validation, plain ETH transfer, the forward path.
/// (VERIFY/SENDER need EIP-8141 and are tested on the devnet.)
contract CoreNonFrameTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function _bin(string memory f) internal view returns (bytes memory) {
        string memory s = vm.readFile(string.concat("core/out/", f));
        return vm.parseBytes(string.concat("0x", _trim(s)));
    }

    function _trim(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        uint256 n = b.length;
        while (n > 0 && (b[n - 1] == 0x0a || b[n - 1] == 0x0d)) n--;
        bytes memory o = new bytes(n);
        for (uint256 i; i < n; i++) o[i] = b[i];
        return string(o);
    }

    function _args(address logic, uint8 mode) internal pure returns (bytes memory) {
        return abi.encodePacked(
            logic, mode, uint128(3 gwei), uint128(2 gwei), uint64(300_000), uint64(200_000), address(0), uint32(50_000),
            uint32(256), uint32(256)
        );
    }

        /// @dev Core initcode = creation ++ 101 args ++ 84 owner bytes (all zero = no owner).
    function _init(bytes memory c, bytes memory args) internal pure returns (bytes memory) {
        return bytes.concat(c, args, new bytes(84));
    }

    function _deploy(bytes memory initcode) internal returns (address a) {
        assembly {
            a := create(0, add(initcode, 0x20), mload(initcode))
        }
    }

    function test_deployAppendsArgs() public {
        address logic = address(new AlwaysTrueRule());
        bytes memory args = _args(logic, 0);
        address k = _deploy(_init(_bin("PopcornCore.bin"), args));
        require(k != address(0), "deploy");
        require(keccak256(k.code) == keccak256(bytes.concat(_bin("PopcornCore.runtime.bin"), args)), "code = runtime ++ args");
    }

    function test_deployRejectsBadArgs() public {
        address logic = address(new AlwaysTrueRule());
        bytes memory c = _bin("PopcornCore.bin");
        require(_deploy(bytes.concat(c, _args(logic, 0), new bytes(85))) == address(0), "102 + 84 bytes");
        require(_deploy(c) == address(0), "0 bytes");
        require(_deploy(_init(c, _args(logic, 2))) == address(0), "mode 2");
        require(_deploy(_init(c, _args(address(0xbeef), 0))) == address(0), "logic without code");
        require(_deploy(_init(c, _args(logic, 255))) == address(0), "mode 255");
        require(_deploy(_init(c, _args(logic, 1))) != address(0), "mode 1 (caller-pays) deploys");
    }

    function _code(bytes memory ret) internal pure returns (uint256) {
        require(ret.length == 32, "32-byte Core code");
        return abi.decode(ret, (uint256));
    }

    function _forwardRule() internal returns (address k, ForwardRule logic) {
        logic = new ForwardRule();
        k = _deploy(_init(_bin("PopcornCore.bin"), _args(address(logic), 0)));
        require(k != address(0), "deploy");
    }

    function test_plainTransferAccepted_reservedSelectorsRefused() public {
        address logic = address(new AlwaysTrueRule());
        address k = _deploy(_init(_bin("PopcornCore.bin"), _args(logic, 0)));
        (bool a,) = k.call{value: 1 ether}("");
        require(a && k.balance == 1 ether, "plain transfer");
        require(payable(k).send(1), "transfer with 2300 stipend");
        // the reserved selectors (the four hooks, owner(bytes) and ownerBump()) never reach logic through the forward path (0x38)
        bytes[7] memory calls = [
            bytes(hex"d9292504"),
            abi.encodeWithSelector(0xd9292504, bytes("x")),
            abi.encodeWithSelector(0x6019566d, bytes("x"), address(this)),
            abi.encodeWithSelector(0x97031c8c, bytes("x")),
            abi.encodeWithSelector(0x05f661f0, bytes("x"), bytes("")),
            abi.encodeWithSelector(0xbd27b241, bytes("x")), // owner(bytes)
            abi.encodeWithSelector(0x91b5d060) // ownerBump()
        ];
        for (uint256 i; i < calls.length; i++) {
            (bool ok, bytes memory ret) = k.call(calls[i]);
            require(!ok && _code(ret) == 0x38, "reserved selector refused with 0x38");
        }
        (bool c, bytes memory r2) = k.call{value: 1}(abi.encodeWithSelector(0xd9292504, bytes("x")));
        require(!c && _code(r2) == 0x38 && k.balance == 1 ether + 1, "with value too; value not kept");
    }

    function test_shortCalldataRefused() public {
        (address k,) = _forwardRule();
        bytes[3] memory calls = [bytes(hex"01"), bytes(hex"0102"), bytes(hex"601956")];
        for (uint256 i; i < calls.length; i++) {
            (bool ok, bytes memory ret) = k.call(calls[i]);
            require(!ok && _code(ret) == 0x3a, "short calldata refused with 0x3a");
        }
    }

    function test_unknownSelectorRevertsInLogic() public {
        address logic = address(new AlwaysTrueRule());
        address k = _deploy(_init(_bin("PopcornCore.bin"), _args(logic, 0)));
        (bool ok, bytes memory ret) = k.call(hex"deadbeef");
        require(!ok && ret.length == 0, "logic without the function: plain revert, as in v1");
    }

    function test_forwardedCall_returnsData_senderAndValue_writesRuleContractStorage() public {
        (address k, ForwardRule logic) = _forwardRule();
        (bool ok, bytes memory ret) = k.call{value: 3 wei}(abi.encodeCall(ForwardRule.ping, (42)));
        require(ok, "forwarded");
        (address sender, uint256 value, uint256 count, uint256 echo, bool inAction) = abi.decode(ret, (address, uint256, uint256, uint256, bool));
        require(sender == address(this), "msg.sender = external caller");
        require(value == 3 && k.balance == 3, "msg.value passes through and stays in the rule contract");
        require(count == 1 && echo == 42 && !inAction, "return data verbatim");
        require(uint256(vm.load(k, logic.COUNT_SLOT())) == 1, "written in the rule contract's storage");
        require(uint256(vm.load(address(logic), logic.COUNT_SLOT())) == 0, "not the logic's");
        (ok,) = k.call(abi.encodeCall(ForwardRule.set, (5)));
        require(ok && uint256(vm.load(k, logic.VALUE_SLOT())) == 5, "set");
    }

    function test_forwardedRevertBubbledVerbatim() public {
        (address k,) = _forwardRule();
        (bool ok, bytes memory ret) = k.call(abi.encodeCall(ForwardRule.boom, (77)));
        require(!ok && keccak256(ret) == keccak256(abi.encodeWithSelector(ForwardRule.Boom.selector, 77)), "revert data verbatim");
    }

    function test_forwardedCallRefusedWhileLocked() public {
        (address k, ForwardRule logic) = _forwardRule();
        Bouncer b = new Bouncer();
        (bool ok, bytes memory ret) = k.call(abi.encodeCall(ForwardRule.lockedPing, (b)));
        require(ok, "outer forwarded call");
        (bool innerOk, bytes memory innerRet) = abi.decode(ret, (bool, bytes));
        require(!innerOk && _code(innerRet) == 0x39, "call-back during the lock refused with 0x39");
        require(uint256(vm.load(k, logic.VALUE_SLOT())) == 0, "nothing written");
        // after the lock is cleared the same call-back works
        (ok,) = address(b).call(abi.encodeCall(Bouncer.bounce, (k, abi.encodeCall(ForwardRule.set, (9)))));
        require(ok && uint256(vm.load(k, logic.VALUE_SLOT())) == 9, "unlocked call-back");
    }

    function test_forwardedFunctionOnLogicDirectlyReverts() public {
        ForwardRule logic = new ForwardRule();
        (bool ok, bytes memory ret) = address(logic).call(abi.encodeCall(ForwardRule.ping, (1)));
        require(!ok && bytes4(ret) == RuleContract.DirectCall.selector, "forwarded modifier: DirectCall");
    }

    receive() external payable {}
}
