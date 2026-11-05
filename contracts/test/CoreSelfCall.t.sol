// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SelfCallRule} from "src/mocks/SelfCallRule.sol";
import {Bouncer} from "src/mocks/Bouncer.sol";

interface Vm {
    function readFile(string calldata) external view returns (string memory);
    function parseBytes(string calldata) external pure returns (bytes memory);
    function load(address, bytes32) external view returns (bytes32);
}

/// Core regression: a forwarded function that calls address(this) with
/// pop(bytes) from ANOTHER account's frame tx must not run __action. Foundry has no frame opcodes, so this runs the
/// real Core source compiled with the frame opcodes stubbed (core/build.sh):
///   stub-foreign: executing frame 1, a SENDER frame, tx.sender 0xdead  → the SENDER routine must stop at 0x3b
///   stub-frame2:  executing frame 2, a SENDER frame, tx.sender = rule contract → must stop at 0x3c
contract CoreSelfCallTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function _bin(string memory f) internal view returns (bytes memory) {
        bytes memory b = bytes(vm.readFile(string.concat("core/out/", f)));
        uint256 n = b.length;
        while (n > 0 && (b[n - 1] == 0x0a || b[n - 1] == 0x0d)) n--;
        bytes memory o = new bytes(n);
        for (uint256 i; i < n; i++) o[i] = b[i];
        return vm.parseBytes(string.concat("0x", string(o)));
    }

    function _ruleContract(string memory stub) internal returns (address k, SelfCallRule logic) {
        logic = new SelfCallRule();
        bytes memory init = bytes.concat(
            _bin(stub),
            abi.encodePacked(address(logic), uint8(0), uint128(3 gwei), uint128(2 gwei), uint64(300_000), uint64(200_000), address(0), uint32(50_000), uint32(256), uint32(256)),
            new bytes(84) // no owner (Core initcode: 101 args ++ 84 owner bytes)
        );
        assembly {
            k := create(0, add(init, 0x20), mload(init))
        }
        require(k != address(0), "deploy");
    }

    function _pops() internal pure returns (bytes[] memory calls) {
        calls = new bytes[](3);
        for (uint256 i; i < 3; i++) calls[i] = abi.encodeWithSelector(0xd9292504, abi.encode(i)); // pop(bytes)
    }

    function _check(string memory stub, uint256 code, bool viaContract) internal {
        (address k, SelfCallRule logic) = _ruleContract(stub);
        bytes memory data = abi.encodeCall(SelfCallRule.batch, (_pops()));
        bool ok;
        if (viaContract) {
            Bouncer b = new Bouncer();
            (bool innerOk,) = b.bounce(k, data);
            ok = innerOk;
        } else {
            (ok,) = k.call(data);
        }
        require(ok, "forwarded batch runs");
        require(uint256(vm.load(k, logic.LAST_SLOT())) == code, "self-call refused with the expected Core code");
        require(uint256(vm.load(k, logic.FIRED())) == 0, "__action never ran");
    }

    function test_foreignSenderFrame_selfCallRefused_0x3b() public {
        _check("PopcornCore.stub-foreign.bin", 0x3b, false);
    }

    function test_foreignSenderFrame_viaContract_selfCallRefused_0x3b() public {
        _check("PopcornCore.stub-foreign.bin", 0x3b, true);
    }

    function test_ruleContractSenderButNotFrame1_selfCallRefused_0x3c() public {
        _check("PopcornCore.stub-frame2.bin", 0x3c, false);
    }
}
