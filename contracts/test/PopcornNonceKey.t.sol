// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreHarness} from "test/CoreHarness.sol";
import {RuleContract} from "src/rules/RuleContract.sol";

/// A key derived from address(this) and storage, like GuardedVault's bounty key.
contract AddressKeyRule is RuleContract {
    bytes32 private constant EPOCH = keccak256("popcorn.test.addressKey.epoch");

    function bump() external forwarded {
        _sstore(EPOCH, _sload(EPOCH) + 1);
    }

    function nonceKey(bytes calldata popArgs) internal view override returns (uint256) {
        return uint256(keccak256(abi.encode("bounty", address(this), _sload(EPOCH), popArgs.length)));
    }

    function condition() internal pure override returns (bool) {
        return true;
    }

    function action() internal override {}
}

/// popcornNonceKey (the forwarded view the SDK reads) equals what Core's __nonceKey computes in VERIFY, including keys
/// that depend on the rule contract's own address and storage.
contract PopcornNonceKeyTest {
    function test_view_matches_verify_for_address_and_storage_keys() public {
        AddressKeyRule logic = new AddressKeyRule();
        CoreHarness h = new CoreHarness(address(logic), 50_000);
        bytes memory a = abi.encode(uint256(7));
        (bool ok, uint256 verifyKey) = h.nonceKey(a);
        require(ok, "verify key");
        require(AddressKeyRule(address(h)).popcornNonceKey(a) == verifyKey, "view == VERIFY key");
        require(verifyKey == uint256(keccak256(abi.encode("bounty", address(h), uint256(0), a.length))), "uses the rule contract's address");
        AddressKeyRule(address(h)).bump();
        (, uint256 k2) = h.nonceKey(a);
        require(k2 != verifyKey && AddressKeyRule(address(h)).popcornNonceKey(a) == k2, "follows storage");
    }

    function test_view_on_the_logic_itself_reverts() public {
        AddressKeyRule logic = new AddressKeyRule();
        bool ok;
        try logic.popcornNonceKey("") returns (uint256) { ok = true; } catch {}
        require(!ok, "forwarded only");
    }
}
