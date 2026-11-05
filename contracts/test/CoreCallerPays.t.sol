// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CallerPays} from "src/payers/CallerPays.sol";

interface Vm {
    function readFile(string calldata) external view returns (string memory);
    function parseBytes(string calldata) external pure returns (bytes memory);
    function load(address, bytes32) external view returns (bytes32);
    function deal(address, uint256) external;
}

/// Records what __action saw; `selfPop` reaches Core's SENDER routine (caller == self) the way a SENDER frame does.
contract SpProbe is CallerPays {
    bytes32 public constant PAYER = keccak256("popcorn.test.SpProbe.payer");
    bytes32 public constant RESULT = keccak256("popcorn.test.SpProbe.result");

    function selfPop(bytes calldata popArgs) external forwarded {
        (bool ok, bytes memory r) = address(this).call(abi.encodeWithSelector(0xd9292504, popArgs));
        _sstore(RESULT, ok ? 1 : (r.length >= 32 ? uint256(bytes32(r)) : 0xff));
    }

    function nonceKey() internal pure override returns (uint256) {
        return 1;
    }

    function condition() internal pure override returns (bool) {
        return true;
    }

    function action(bytes calldata, address payer_) internal override {
        _sstore(PAYER, uint256(uint160(payer_)));
        _payReward(address(0), 7);
    }
}

/// Core SENDER routine in mode 1, on the REAL Core source with the frame opcodes stubbed (core/build.sh):
///   stub-sp     : executing frame 2 (a SENDER frame), tx.sender = rule contract, FRAMEPARAM(target, 1) = 0xb0b
///   stub-frame1 : same, executing frame 1
contract CoreCallerPaysTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function _bin(string memory f) internal view returns (bytes memory) {
        bytes memory b = bytes(vm.readFile(string.concat("core/out/", f)));
        uint256 n = b.length;
        while (n > 0 && (b[n - 1] == 0x0a || b[n - 1] == 0x0d)) n--;
        bytes memory o = new bytes(n);
        for (uint256 i; i < n; i++) o[i] = b[i];
        return vm.parseBytes(string.concat("0x", string(o)));
    }

    function _ruleContract(string memory stub, uint8 mode) internal returns (address k, SpProbe logic) {
        logic = new SpProbe();
        bytes memory init = bytes.concat(
            _bin(stub),
            abi.encodePacked(address(logic), mode, uint128(0), uint128(0), uint64(300_000), uint64(200_000), address(0), uint32(50_000), uint32(0), uint32(64)),
            new bytes(84) // no owner
        );
        assembly {
            k := create(0, add(init, 0x20), mload(init))
        }
        require(k != address(0), "deploy");
        vm.deal(k, 1 ether);
    }

    function _run(string memory stub, uint8 mode) internal returns (address k, SpProbe logic, uint256 result) {
        (k, logic) = _ruleContract(stub, mode);
        (bool ok,) = k.call(abi.encodeCall(SpProbe.selfPop, (hex"c0ffee")));
        require(ok, "forwarded selfPop runs");
        result = uint256(vm.load(k, logic.RESULT()));
    }

    /// Mode 1 at frame 2: __action runs with payer = FRAMEPARAM(target, 1) (0xb0b), and the reward goes to it.
    function test_mode1_frame2_actionGetsFrame1Target() public {
        (address k, SpProbe logic, uint256 result) = _run("PopcornCore.stub-sp.bin", 1);
        require(result == 1, "SENDER routine ran __action");
        require(uint256(vm.load(k, logic.PAYER())) == 0xb0b, "payer = frame 1 target");
        require(address(0xb0b).balance == 7, "reward paid to the payer Core passed");
    }

    /// Mode 0 at frame 2: refused (0x3c).
    function test_mode0_frame2_refused_0x3c() public {
        (address k, SpProbe logic, uint256 result) = _run("PopcornCore.stub-sp.bin", 0);
        require(result == 0x3c, "0x3c");
        require(uint256(vm.load(k, logic.PAYER())) == 0, "no action");
    }

    /// Mode 1 at frame 1 (the payer's frame index): refused (0x3c).
    function test_mode1_frame1_refused_0x3c() public {
        (address k, SpProbe logic, uint256 result) = _run("PopcornCore.stub-frame1.bin", 1);
        require(result == 0x3c, "0x3c");
        require(uint256(vm.load(k, logic.PAYER())) == 0, "no action");
    }

    /// Mode 1, tx.sender != rule contract (another account's SENDER frame): refused (0x3b).
    function test_mode1_foreignSender_refused_0x3b() public {
        (, , uint256 result) = _run("PopcornCore.stub-foreign.bin", 1);
        require(result == 0x3b, "0x3b");
    }
}
