// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreHarness} from "test/CoreHarness.sol";
import {IIntentScheme} from "src/signers/IIntentScheme.sol";
import {ForsSigner} from "src/signers/ForsSigner.sol";
import {XmssSigner} from "src/signers/XmssSigner.sol";
import {SphincsSigner} from "src/signers/SphincsSigner.sol";
import {FalconSigner} from "src/signers/FalconSigner.sol";
import {HybridEcdsaSigner} from "src/signers/HybridEcdsaSigner.sol";
import {EcdsaIntentCounter, WotsIntentCounter, ForsIntentCounter, XmssIntentCounter} from "src/mocks/IntentCounters.sol";

interface Vm {
    function readFile(string calldata) external view returns (string memory);
    function parseJsonBytes(string calldata, string calldata) external pure returns (bytes memory);
    function parseJsonBytes32(string calldata, string calldata) external pure returns (bytes32);
    function parseJsonAddress(string calldata, string calldata) external pure returns (address);
    function parseJsonUint(string calldata, string calldata) external pure returns (uint256);
    function chainId(uint256) external;
    function prank(address) external;
    function etch(address, bytes calldata) external;
}

abstract contract PqBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    event log_named_uint(string key, uint256 val);

    string internal J;
    address internal K;
    uint256 internal ruleId;
    uint256 internal epoch;
    bytes internal popArgs;
    bytes internal ctx;

    function setUp() public virtual {
        J = vm.readFile("test/fixtures/pq-vectors.json");
        vm.chainId(vm.parseJsonUint(J, ".chainId"));
        K = vm.parseJsonAddress(J, ".ruleContract");
        ruleId = vm.parseJsonUint(J, ".ruleId");
        epoch = vm.parseJsonUint(J, ".ruleEpoch");
        popArgs = vm.parseJsonBytes(J, ".popArgs");
        ctx = vm.parseJsonBytes(J, ".context");
    }

    function _b(string memory key) internal view returns (bytes memory) {
        return vm.parseJsonBytes(J, key);
    }

    function _ctx(uint256 id, uint256 e, bytes memory args) internal pure returns (bytes memory) {
        return abi.encode(id, e, keccak256(args));
    }

    function _flip(bytes memory b, uint256 i) internal pure returns (bytes memory c) {
        c = abi.encodePacked(b);
        c[i] = bytes1(uint8(c[i]) ^ 0x01);
    }

    function _cut(bytes memory b, uint256 n) internal pure returns (bytes memory c) {
        c = new bytes(n);
        for (uint256 i; i < n; i++) c[i] = b[i];
    }

    function _chk(IIntentScheme p, address ruleContract, bytes memory params, bytes memory context, bytes memory w) internal returns (bool) {
        vm.prank(ruleContract);
        return p.check(params, context, w);
    }

    function _ok(IIntentScheme p, bytes memory params, bytes memory w) internal returns (bool) {
        return _chk(p, K, params, ctx, w);
    }

    function _gas(IIntentScheme p, string memory name, bytes memory params, bytes memory w) internal {
        vm.prank(K);
        uint256 g = gasleft();
        bool r = p.check(params, ctx, w);
        g -= gasleft();
        require(r, "gas probe: check failed");
        emit log_named_uint(name, g);
    }

    function _contextNegatives(IIntentScheme p, bytes memory params, bytes memory w) internal {
        require(_ok(p, params, w), "baseline");
        require(!_chk(p, K, params, _ctx(ruleId + 1, epoch, popArgs), w), "other rule");
        require(!_chk(p, K, params, _ctx(ruleId, epoch + 1, popArgs), w), "other epoch");
        require(!_chk(p, K, params, _ctx(ruleId, epoch, _flip(popArgs, 0)), w), "other popArgs");
        require(!_chk(p, K, params, _cut(ctx, 95), w), "short context");
        require(!_chk(p, K, params, "", w), "empty context");
        require(!_chk(p, address(uint160(K) + 1), params, ctx, w), "other rule contract");
        vm.chainId(1);
        require(!_ok(p, params, w), "other chain");
        vm.chainId(vm.parseJsonUint(J, ".chainId"));
    }

    /// flip one byte in every region of a witness (regions given by step) and require refusal
    function _tamper(IIntentScheme p, bytes memory params, bytes memory w, uint256 step) internal {
        for (uint256 i; i < w.length; i += step) require(!_chk(p, K, params, ctx, _flip(w, i)), "tampered byte accepted");
        require(!_chk(p, K, params, ctx, _flip(w, w.length - 1)), "last byte");
        require(!_chk(p, K, params, ctx, _cut(w, w.length - 1)), "short");
        require(!_chk(p, K, params, ctx, abi.encodePacked(w, hex"00")), "long");
        require(!_chk(p, K, params, ctx, ""), "empty");
        require(!_chk(p, K, params, ctx, new bytes(w.length)), "zeros");
    }
}

contract ForsIntentTest is PqBase {
    ForsSigner p;
    bytes params;
    bytes w;

    function setUp() public override {
        super.setUp();
        p = new ForsSigner();
        params = _b(".fors.params");
        w = _b(".fors.witness");
    }

    function test_valid() public {
        require(w.length == 6944, "witness length");
        require(_ok(p, params, w), "valid");
        _gas(p, "fors check gas", params, w);
    }

    function test_contextBinding() public {
        _contextNegatives(p, params, w);
    }

    function test_tamperedEveryRegion() public {
        _tamper(p, params, w, 97);
        require(!_ok(p, params, _flip(w, 0)), "salt");
        require(!_ok(p, params, _flip(w, 32)), "first revealed leaf");
        require(!_ok(p, params, _flip(w, 64)), "first auth node");
    }

    function test_wrongKeyAndParams() public {
        require(!_ok(p, _flip(params, 0), w), "other pk");
        require(!_ok(p, _flip(params, 40), w), "other pubSeed");
        require(!_ok(p, _cut(params, 159), w), "short params");
        require(!_ok(p, abi.encodePacked(params, hex"00"), w), "long params");
    }

    function _fp(uint256 first) internal view returns (bytes memory) {
        return abi.encodePacked(_cut(params, 64), first, vm.parseJsonUint(J, ".chainId"), ruleId);
    }

    function test_keyIsBoundToOneChainAndOneRule() public {
        require(!_ok(p, abi.encodePacked(_cut(params, 128), ruleId + 1), w), "bound to another rule");
        require(!_ok(p, abi.encodePacked(_cut(params, 96), vm.parseJsonUint(J, ".chainId") + 1, ruleId), w), "bound to another chain");
    }

    function test_epochWindowIsEightSignatures() public {
        // firstEpoch 3: epochs 3..10 are inside the window (signatures are valid for the digest of each epoch), 11 is not
        bytes memory last = _b(".forsEdge.last");
        require(_chk(p, K, params, _ctx(ruleId, 10, popArgs), last), "epoch first + 7 accepted");
        bytes memory past = _b(".forsEdge.past");
        require(!_chk(p, K, params, _ctx(ruleId, 11, popArgs), past), "epoch first + 8 refused although the signature is valid for it");
        // the window moves with firstEpoch: with firstEpoch 4, epoch 3 is below it, with firstEpoch 11 the epoch-11 signature is accepted
        require(!_ok(p, _fp(8), w), "epoch 7 below firstEpoch 8");
        require(_chk(p, K, _fp(4), _ctx(ruleId, 11, popArgs), past), "window 4..11 includes 11");
    }

    function testFuzz_junkNeverVerifies(bytes calldata junk) public {
        require(!_ok(p, params, junk), "junk");
    }
}

contract XmssIntentTest is PqBase {
    XmssSigner p;

    function setUp() public override {
        super.setUp();
        p = new XmssSigner();
    }

    function _xp(uint256 first, uint256 height) internal view returns (bytes memory) {
        return abi.encodePacked(_cut(_b(".xmss4.params"), 64), first, height, vm.parseJsonUint(J, ".chainId"), ruleId);
    }

    function test_validHeight4() public {
        bytes memory params = _b(".xmss4.params");
        bytes memory w = _b(".xmss4.witness");
        require(w.length == 32 + 32 * (67 + 4), "witness length");
        require(_ok(p, params, w), "valid");
        _gas(p, "xmss h=4 check gas", params, w);
    }

    function test_validHeight10() public {
        bytes memory params = _b(".xmss10.params");
        bytes memory w = _b(".xmss10.witness");
        require(w.length == 32 + 32 * (67 + 10), "witness length");
        require(_ok(p, params, w), "valid");
        _gas(p, "xmss h=10 check gas", params, w);
    }

    function test_contextBinding() public {
        _contextNegatives(p, _b(".xmss4.params"), _b(".xmss4.witness"));
        _contextNegatives(p, _b(".xmss10.params"), _b(".xmss10.witness"));
    }

    function test_tamperedEveryRegion() public {
        _tamper(p, _b(".xmss4.params"), _b(".xmss4.witness"), 211);
        bytes memory w = _b(".xmss10.witness");
        for (uint256 i = 32; i < w.length; i += 331) require(!_ok(p, _b(".xmss10.params"), _flip(w, i)), "chain/path byte");
        require(!_ok(p, _b(".xmss10.params"), _flip(w, 0)), "salt");
    }

    function test_leafIsBoundToTheEpochAndParams() public {
        bytes memory params = _b(".xmss4.params");
        bytes memory w = _b(".xmss4.witness");
        require(!_ok(p, _xp(4, 4), w), "other firstEpoch -> other leaf");
        require(!_ok(p, _xp(8, 4), w), "epoch below firstEpoch");
        require(!_ok(p, _xp(5, 1), w), "height 1: q = 2 is out of range (and the witness length is wrong)");
        require(!_ok(p, _xp(5, 5), w), "height mismatch");
        require(!_ok(p, _xp(5, 0), w), "height 0");
        require(!_ok(p, _xp(5, 21), w), "height above 20");
        require(!_ok(p, _flip(params, 0), w), "other root");
        require(!_ok(p, _flip(params, 33), w), "other seed");
        require(!_ok(p, _cut(params, 191), w), "short params");
        require(!_ok(p, abi.encodePacked(_cut(params, 160), ruleId + 1), w), "key bound to another rule");
        require(!_ok(p, abi.encodePacked(_cut(params, 128), vm.parseJsonUint(J, ".chainId") + 1, ruleId), w), "key bound to another chain");
    }

    function testFuzz_junkNeverVerifies(bytes calldata junk) public {
        require(!_ok(p, _b(".xmss4.params"), junk), "junk");
    }
}

contract HybridPqIntentTest is PqBase {
    HybridEcdsaSigner g;
    ForsSigner fors;
    XmssSigner xmss;

    function setUp() public override {
        super.setUp();
        g = new HybridEcdsaSigner();
        fors = new ForsSigner();
        xmss = new XmssSigner();
    }

    function _params(address inner, bytes memory innerParams) internal view returns (bytes memory) {
        return abi.encodePacked(vm.parseJsonAddress(J, ".ecdsa.signer"), inner, innerParams);
    }

    function test_ecdsaPlusFors() public {
        bytes memory params = _params(address(fors), _b(".fors.params"));
        bytes memory w = abi.encodePacked(_b(".ecdsa.witness"), _b(".fors.witness"));
        require(_ok(g, params, w), "valid");
        _gas(g, "hybrid ecdsa+fors check gas", params, w);
        _contextNegatives(g, params, w);
        require(!_ok(g, params, abi.encodePacked(new bytes(65), _b(".fors.witness"))), "ecdsa half missing");
        require(!_ok(g, params, abi.encodePacked(_b(".ecdsa.witness"), _flip(_b(".fors.witness"), 70))), "fors half tampered");
        require(!_ok(g, params, _b(".fors.witness")), "fors only");
    }

    function test_ecdsaPlusXmss() public {
        bytes memory params = _params(address(xmss), _b(".xmss4.params"));
        bytes memory w = abi.encodePacked(_b(".ecdsa.witness"), _b(".xmss4.witness"));
        require(_ok(g, params, w), "valid");
        _gas(g, "hybrid ecdsa+xmss h=4 check gas", params, w);
        _contextNegatives(g, params, w);
        require(!_ok(g, params, abi.encodePacked(_flip(_b(".ecdsa.witness"), 4), _b(".xmss4.witness"))), "ecdsa tampered");
    }
}

/// The inline triggers through CoreHarness etched at the vectors' rule contract address (the digest names the rule contract).
contract InlineIntentTriggerTest is PqBase {
    function _ruleContract(address logic) internal returns (CoreHarness h) {
        vm.etch(K, address(new CoreHarness(logic, 200_000)).code);
        h = CoreHarness(payable(K));
    }

    function _run(CoreHarness h, bytes memory args, bytes memory w0, bytes memory w1) internal {
        require(h.condition(args, w0), "epoch 0 signature accepted");
        require(!h.condition(args, w1), "epoch 1 signature not yet");
        h.pop(args, w0);
        require(!h.condition(args, w0), "replay refused");
        (bool ok,) = address(h).call(abi.encodeCall(CoreHarness.pop, (args, w0)));
        require(!ok, "second trigger refused");
        require(h.condition(args, w1), "epoch 1 signature accepted after the first trigger");
        h.pop(args, w1);
        require(h.load(keccak256(abi.encode(keccak256("popcorn.signedIntent.epoch"), uint256(1)))) == 2, "two epochs consumed");
        require(h.load(keccak256(abi.encode(keccak256("popcorn.example.signedIntentCounter.total"), uint256(1)))) == 14, "action ran twice (7 + 7)");
    }

    function test_ecdsaInline() public {
        CoreHarness h = _ruleContract(address(new EcdsaIntentCounter(vm.parseJsonAddress(J, ".inline.ecdsaSigner"))));
        _run(h, _b(".inline.popArgs"), _b(".inline.ecdsa0"), _b(".inline.ecdsa1"));
    }

    function test_wotsInline() public {
        CoreHarness h = _ruleContract(address(new WotsIntentCounter(vm.parseJsonBytes32(J, ".inline.wots.root"), vm.parseJsonBytes32(J, ".inline.wots.pubSeed"), 0, 1338, 1)));
        _run(h, _b(".inline.popArgs"), _b(".inline.wots.w0"), _b(".inline.wots.w1"));
    }

    function test_forsInline() public {
        CoreHarness h = _ruleContract(address(new ForsIntentCounter(vm.parseJsonBytes32(J, ".inline.fors.pk"), vm.parseJsonBytes32(J, ".inline.fors.pubSeed"), 0, 1338, 1)));
        _run(h, _b(".inline.popArgs"), _b(".inline.fors.w0"), _b(".inline.fors.w1"));
    }

    function test_xmssInline() public {
        CoreHarness h = _ruleContract(address(new XmssIntentCounter(vm.parseJsonBytes32(J, ".inline.xmss.root"), vm.parseJsonBytes32(J, ".inline.xmss.seed"), 0, 4, 1338, 1)));
        _run(h, _b(".inline.popArgs"), _b(".inline.xmss.w0"), _b(".inline.xmss.w1"));
    }

    function test_inlineKeyIsBoundToItsRuleAndChain() public {
        // the vector is a valid signature for rule 1; a rule contract whose key is bound to rule 0 (or to another chain id) must refuse it
        bytes32 root = vm.parseJsonBytes32(J, ".inline.wots.root");
        bytes32 seed = vm.parseJsonBytes32(J, ".inline.wots.pubSeed");
        CoreHarness h = _ruleContract(address(new WotsIntentCounter(root, seed, 0, 1338, 0)));
        require(!h.condition(_b(".inline.popArgs"), _b(".inline.wots.w0")), "key bound to rule 0 refuses a rule 1 trigger");
        h = _ruleContract(address(new WotsIntentCounter(root, seed, 0, 1, 1)));
        require(!h.condition(_b(".inline.popArgs"), _b(".inline.wots.w0")), "key bound to chain 1 refuses chain 1338");
        h = _ruleContract(address(new ForsIntentCounter(vm.parseJsonBytes32(J, ".inline.fors.pk"), vm.parseJsonBytes32(J, ".inline.fors.pubSeed"), 0, 1338, 0)));
        require(!h.condition(_b(".inline.popArgs"), _b(".inline.fors.w0")), "FORS bound to rule 0");
        h = _ruleContract(address(new XmssIntentCounter(vm.parseJsonBytes32(J, ".inline.xmss.root"), vm.parseJsonBytes32(J, ".inline.xmss.seed"), 0, 4, 1338, 0)));
        require(!h.condition(_b(".inline.popArgs"), _b(".inline.xmss.w0")), "XMSS bound to rule 0");
    }

    function test_inlineSignatureIsForThisRuleContractOnly() public {
        CoreHarness h = _ruleContract(address(new WotsIntentCounter(vm.parseJsonBytes32(J, ".inline.wots.root"), vm.parseJsonBytes32(J, ".inline.wots.pubSeed"), 0, 1338, 1)));
        address other = address(uint160(K) + 7);
        vm.etch(other, K.code);
        require(!CoreHarness(payable(other)).condition(_b(".inline.popArgs"), _b(".inline.wots.w0")), "another rule contract with the same key");
        require(h.condition(_b(".inline.popArgs"), _b(".inline.wots.w0")), "the vector's rule contract");
    }
}

contract SphincsIntentTest is PqBase {
    SphincsSigner p;
    bytes params;
    bytes w;

    function setUp() public override {
        super.setUp();
        p = new SphincsSigner();
        params = _b(".sphincs.params");
        w = _b(".sphincs.witness");
    }

    function test_valid() public {
        require(w.length == 5200, "witness length");
        require(_ok(p, params, w), "valid");
        _gas(p, "sphincs check gas", params, w);
    }

    function test_contextBinding() public {
        _contextNegatives(p, params, w);
    }

    function test_tamperedEveryRegion() public {
        _tamper(p, params, w, 83);
        require(!_ok(p, params, _flip(w, 0)), "R");
        require(!_ok(p, params, _flip(w, 16)), "first FORS secret leaf");
        require(!_ok(p, params, _flip(w, 32)), "first FORS auth node");
        require(!_ok(p, params, _flip(w, 16 + 26 * 144)), "layer 0 first chain value");
        require(!_ok(p, params, _flip(w, 16 + 26 * 144 + 560)), "layer 0 first auth node");
        require(!_ok(p, params, _flip(w, 16 + 26 * 144 + 720)), "layer 1 first chain value");
        require(!_ok(p, params, _flip(w, 5199)), "last auth node");
    }

    function test_wrongKeyAndParams() public {
        require(!_ok(p, _flip(params, 0), w), "other pubSeed");
        require(!_ok(p, _flip(params, 32), w), "other root");
        require(!_ok(p, _flip(params, 63), w), "root with non-zero low half (refused outright)");
        require(!_ok(p, _cut(params, 63), w), "short params");
        require(!_ok(p, abi.encodePacked(params, hex"00"), w), "long params");
    }

    function testFuzz_junkNeverVerifies(bytes calldata junk) public {
        require(!_ok(p, params, junk), "junk");
    }
}

contract FalconIntentTest is PqBase {
    FalconSigner p;
    bytes params;
    bytes w;

    function setUp() public override {
        super.setUp();
        p = new FalconSigner();
        params = _b(".falcon.params");
        w = _b(".falcon.witness");
    }

    function test_valid() public {
        require(params.length == 1024 && w.length == 1064, "lengths");
        require(_ok(p, params, w), "valid");
        _gas(p, "falcon (ETHFALCON) check gas", params, w);
    }

    function test_contextBinding() public {
        _contextNegatives(p, params, w);
    }

    function test_tampered() public {
        _tamper(p, params, w, 97);
        require(!_ok(p, params, _flip(w, 0)), "salt");
        require(!_ok(p, params, _flip(w, 40)), "s2 first word");
        require(!_ok(p, params, _flip(w, 1063)), "s2 last word");
        require(!_ok(p, _flip(params, 3), w), "other public key");
        require(!_ok(p, _cut(params, 1023), w), "short params");
    }

    function test_s2CoefficientsMustBeBelowQ() public {
        // add q (12289) to the first coefficient of s2: same value mod q, so the verification equation holds, but the
        // reference rejects it as malleable (coefficients >= q)
        bytes memory m = abi.encodePacked(w);
        uint256 word;
        for (uint256 i; i < 32; i++) word = (word << 8) | uint8(m[40 + i]);
        uint256 c0 = word & 0xffff;
        word = (word & ~uint256(0xffff)) | ((c0 + 12289) & 0xffff);
        for (uint256 i; i < 32; i++) m[40 + i] = bytes1(uint8(word >> (8 * (31 - i))));
        require(!_ok(p, params, m), "coefficient + q refused");
    }

    function testFuzz_junkNeverVerifies(bytes calldata junk) public {
        require(!_ok(p, params, junk), "junk");
    }
}
