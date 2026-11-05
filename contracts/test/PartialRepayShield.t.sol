// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreHarness} from "test/CoreHarness.sol";
import {DemoToken} from "src/mocks/DemoToken.sol";
import {MockOracle} from "src/mocks/MockOracle.sol";
import {SimpleLendingPool, IPriceOracle, IERC20Min} from "src/mocks/SimpleLendingPool.sol";
import {PartialRepayShield, IShieldPool, IShieldToken} from "src/templates/PartialRepayShield.sol";
import {RewardRule} from "src/mocks/RewardRule.sol";
import {CallerPays} from "src/payers/CallerPays.sol";

interface Vm {
    function prank(address) external;
    function deal(address, uint256) external;
}

contract User {
    function open(SimpleLendingPool pool, uint256 borrow) external payable {
        pool.deposit{value: msg.value}();
        pool.borrow(borrow);
    }

    function exec(address to, bytes calldata data) external returns (bool ok, bytes memory ret) {
        (ok, ret) = to.call(data);
    }

    receive() external payable {}
}

/// A payer contract that refuses ETH (any plain call reverts), like the minimal "APPROVE on every call" payer. It can
/// still claim its owed reward to another address.
contract RefusingPayer {
    function claim(address ruleContract, address token, address to) external {
        (bool ok, bytes memory r) = ruleContract.call(abi.encodeWithSignature("claimReward(address,address)", token, to));
        if (!ok) {
            assembly {
                revert(add(r, 0x20), mload(r))
            }
        }
    }
}

/// A pool whose repayFor always reverts (the shield's failure path), reporting an unhealthy position.
contract BrokenPool {
    function position(address) external pure returns (uint256, uint256, uint256, uint256) {
        return (1 ether, 800e18, 1, 1.0e18);
    }

    function repayFor(address, uint256) external pure {
        revert("pool down");
    }
}

/// ERC-20 whose transfer to `blocked` returns false (a token refusing the payer).
contract BlockingToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public immutable blocked;

    constructor(address b) {
        blocked = b;
    }

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        if (to == blocked) return false;
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

/// Gate 6 unit tests (Foundry, CoreHarness in caller-pays mode): the shield's condition flips exactly at health factor
/// 1.1, the action repays a quarter of the debt and pays 0.5% to the payer Core passed in, and CallerPays never pays an
/// address taken from popArgs.
contract PartialRepayShieldTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant CONDITION_GAS = 40_000; // the demo rule contract's conditionGas

    DemoToken token;
    MockOracle oracle;
    SimpleLendingPool pool;
    User user;
    PartialRepayShield logic;
    CoreHarness k; // plays the rule contract

    function setUp() public {
        token = new DemoToken("Demo USD", "dUSD");
        oracle = new MockOracle(2_000e18); // 1 ETH = 2,000 dUSD
        pool = new SimpleLendingPool(IPriceOracle(address(oracle)), IERC20Min(address(token)));
        token.mint(address(pool), 1_000_000e18);
        user = new User();
        vm.deal(address(this), 10 ether);
        // 1 ETH collateral, 800 dUSD debt: HF = price * 0.8 / 800 = price / 1000 -> 2.0 now, 1.1 at price 1,100
        user.open{value: 1 ether}(pool, 800e18);
        logic = new PartialRepayShield(IShieldPool(address(pool)), IShieldToken(address(token)), address(user), 1.1e18, 2_500, 50, 0.02 ether, 86_400);
        k = new CoreHarness(address(logic), CONDITION_GAS);
        token.mint(address(k), 1_000e18); // the shield's reserve
    }

    function test_conditionFlipsExactlyAtHF1_1() public {
        oracle.setPrice(1_100e18);
        require(pool.healthFactor(address(user)) == 1.1e18, "HF exactly 1.1");
        require(!k.condition("", ""), "HF == 1.1: not rescuable");
        oracle.setPrice(1_100e18 - 1_000);
        require(pool.healthFactor(address(user)) == 1.1e18 - 1, "HF = 1.1 - 1 wei");
        require(k.condition("", ""), "HF < 1.1: rescuable");
        oracle.setPrice(2_000e18);
        require(!k.condition("", ""), "healthy");
    }

    function test_rescue_repaysAQuarter_paysHalfAPercentToThePayer() public {
        oracle.setPrice(1_080e18); // HF 1.08
        address payer = address(0xB0B);
        uint256 nonceBefore = pool.positionNonce(address(user));
        (bool ok, uint256 keyBefore) = k.nonceKey("");
        require(ok && keyBefore == logic.shieldKey(0), "key = hash(domain, user, rescueEpoch 0)");
        uint256 reserve = token.balanceOf(address(k));
        uint256 key = k.popCallerPays("", "", payer);
        require(key == keyBefore, "consumed the position key");
        (, uint256 debt,,) = pool.position(address(user));
        require(debt == 600e18, "debt 800 -> 600: a quarter repaid");
        require(token.balanceOf(payer) == 1e18, "reward 0.5% of 200 = 1 dUSD to the payer");
        require(token.balanceOf(address(k)) == reserve - 201e18, "reserve paid 200 + 1");
        require(pool.positionNonce(address(user)) == nonceBefore + 1, "positionNonce bumped");
        (, uint256 keyAfter) = k.nonceKey("");
        require(keyAfter == logic.shieldKey(1), "the action advanced the rescue epoch: the old key is gone");
        require(k.load(logic.RESCUE_EPOCH_SLOT()) == 1, "epoch 1");
        require(pool.healthFactor(address(user)) > 1.1e18, "rescued");
        // a second trigger right away: the position is healthy again
        try k.popCallerPays("", "", payer) {
            revert("must be invalid");
        } catch (bytes memory r) {
            require(keccak256(r) == keccak256(abi.encodeWithSelector(CoreHarness.InvalidPop.selector, uint8(0x22))), "condition false");
        }
    }

    function test_payerOfACopyGetsTheReward() public {
        oracle.setPrice(1_080e18);
        // the same trigger paid by someone else: the reward follows the payer, not the original sender
        k.popCallerPays("", "", address(0xC0C0));
        require(token.balanceOf(address(0xC0C0)) == 1e18 && token.balanceOf(address(0xB0B)) == 0, "reward to the copy's payer");
    }

    function test_notRescuable_reserveTooSmall_noDebt_popArgs() public {
        oracle.setPrice(1_080e18);
        require(k.condition("", ""), "rescuable");
        require(!k.condition(abi.encode(address(0xBAD)), ""), "non-empty popArgs: invalid");
        // reserve below amount * 1.005: 200 + 1 needed
        PartialRepayShield l2 = new PartialRepayShield(IShieldPool(address(pool)), IShieldToken(address(token)), address(user), 1.1e18, 2_500, 50, 0, 0);
        CoreHarness k2 = new CoreHarness(address(l2), CONDITION_GAS);
        token.mint(address(k2), 201e18 - 1);
        require(!k2.condition("", ""), "reserve 200.99..: not covered");
        token.mint(address(k2), 1);
        require(k2.condition("", ""), "reserve 201: covered");
        // no debt
        PartialRepayShield l3 = new PartialRepayShield(IShieldPool(address(pool)), IShieldToken(address(token)), address(0x1234), 1.1e18, 2_500, 50, 0, 0);
        CoreHarness k3 = new CoreHarness(address(l3), CONDITION_GAS);
        token.mint(address(k3), 1_000e18);
        require(!k3.condition("", ""), "no debt: nothing to rescue");
    }

    /// The action never reverts: not rescuable at action time -> RescueSkipped, epoch still advances,
    /// nothing paid; and nothing ever goes to an address in popArgs.
    function test_actionNeverReverts_skipAdvancesEpoch_neverPaysPopArgs() public {
        // healthy: not rescuable
        k.actionAs(abi.encode(address(0xBAD)), address(0xB0B));
        require(k.load(logic.RESCUE_EPOCH_SLOT()) == 1, "epoch advanced although nothing was rescued");
        require(token.balanceOf(address(0xBAD)) == 0 && token.balanceOf(address(0xB0B)) == 0, "nothing paid");
        (, uint256 debt,,) = pool.position(address(user));
        require(debt == 800e18, "no repayment");
        // recovery: the danger comes, the next epoch's trigger rescues
        oracle.setPrice(1_080e18);
        uint256 key = k.popCallerPays("", "", address(0xB0B));
        require(key == logic.shieldKey(1), "next epoch's key");
        (, debt,,) = pool.position(address(user));
        require(debt == 600e18 && token.balanceOf(address(0xB0B)) == 1e18, "rescued after the skip");
    }

    /// Failure path: the pool's repayFor reverts -> RescueSkipped(reason 3), epoch advanced, allowance cleared, no reward,
    /// no revert; the shield is not bricked (the next epoch is valid).
    function test_repayFails_actionSkips_notBricked() public {
        BrokenPool bp = new BrokenPool();
        PartialRepayShield l2 = new PartialRepayShield(IShieldPool(address(bp)), IShieldToken(address(token)), address(user), 1.1e18, 2_500, 50, 0, 0);
        CoreHarness k2 = new CoreHarness(address(l2), CONDITION_GAS);
        token.mint(address(k2), 1_000e18);
        require(k2.condition("", ""), "rescuable per the pool");
        k2.popCallerPays("", "", address(0xB0B));
        require(k2.load(l2.RESCUE_EPOCH_SLOT()) == 1, "epoch advanced");
        require(token.balanceOf(address(0xB0B)) == 0 && token.balanceOf(address(k2)) == 1_000e18, "no reward, reserve intact");
        require(token.allowance(address(k2), address(bp)) == 0, "allowance cleared");
        (bool ok, uint256 key) = k2.nonceKey("");
        require(ok && key == l2.shieldKey(1) && !k2.usedKey(key) && k2.condition("", ""), "next epoch still valid: not bricked");
    }

    /// Rescue chain: each trigger repays a quarter of the remaining debt until the loan is healthy.
    function test_rescueChainUntilHealthy() public {
        oracle.setPrice(700e18); // HF 0.7
        uint256 pops;
        uint256[3] memory debts;
        while (k.condition("", "")) {
            k.popCallerPays("", "", address(0xB0B));
            (, debts[pops],,) = pool.position(address(user));
            pops++;
        }
        require(pops == 2, "two triggers: 800 -> 600 (HF 0.93) -> 450 (HF 1.24)");
        require(debts[0] == 600e18 && debts[1] == 450e18, "a quarter each time");
        require(pool.healthFactor(address(user)) >= 1.1e18, "healthy");
        require(token.balanceOf(address(0xB0B)) == 1e18 + 0.75e18, "reward per trigger: 0.5% of 200 + 0.5% of 150");
        require(k.load(logic.RESCUE_EPOCH_SLOT()) == 2, "two epochs used");
    }

    /// Reserve exactly amount + reward: rescuable, rescued, reserve 0.
    function test_reserveExactlyAmountPlusReward() public {
        PartialRepayShield l2 = new PartialRepayShield(IShieldPool(address(pool)), IShieldToken(address(token)), address(user), 1.1e18, 2_500, 50, 0, 0);
        CoreHarness k2 = new CoreHarness(address(l2), CONDITION_GAS);
        token.mint(address(k2), 201e18);
        oracle.setPrice(1_080e18);
        k2.popCallerPays("", "", address(0xB0B));
        require(token.balanceOf(address(k2)) == 0 && token.balanceOf(address(0xB0B)) == 1e18, "exact reserve used");
        require(!k2.condition("", ""), "healthy now (and the reserve is empty)");
    }

    /// Griefing: repayFor(user, 0) now reverts; a 1-wei repayFor bumps positionNonce but no longer
    /// touches the shield's key (it is the rule contract's own rescue epoch), so a pending rescue stays valid.
    function test_repayForGriefing() public {
        oracle.setPrice(1_080e18);
        (, uint256 key0) = k.nonceKey("");
        (bool ok, bytes memory r) = address(pool).call(abi.encodeCall(SimpleLendingPool.repayFor, (address(user), 0)));
        require(!ok && bytes4(r) == SimpleLendingPool.ZeroAmount.selector, "zero repay refused");
        token.mint(address(this), 1);
        token.approve(address(pool), 1);
        uint256 n0 = pool.positionNonce(address(user));
        pool.repayFor(address(user), 1);
        require(pool.positionNonce(address(user)) == n0 + 1, "positionNonce moved");
        (, uint256 key1) = k.nonceKey("");
        require(key1 == key0 && k.condition("", ""), "pending rescue key unchanged and still valid");
    }

    /// The reserve is the user's: only `user` withdraws it (forwarded).
    function test_withdrawReserve_onlyUser() public {
        (bool ok, bytes memory r) = address(k).call(abi.encodeCall(PartialRepayShield.withdrawReserve, (address(this), 1e18)));
        require(!ok && bytes4(r) == PartialRepayShield.NotUser.selector, "stranger refused");
        (ok,) = user.exec(address(k), abi.encodeCall(PartialRepayShield.withdrawReserve, (address(user), 400e18)));
        require(ok && token.balanceOf(address(user)) == 800e18 + 400e18 && token.balanceOf(address(k)) == 600e18, "user withdrew");
    }

    /// A token that refuses the payer: the reward is owed (not lost, no revert), claimable to another address.
    function test_tokenRefusesPayer_rewardOwed() public {
        BlockingToken bt = new BlockingToken(address(0xB0B));
        SimpleLendingPool p2 = new SimpleLendingPool(IPriceOracle(address(oracle)), IERC20Min(address(bt)));
        bt.mint(address(p2), 1_000_000e18);
        User u2 = new User();
        u2.open{value: 1 ether}(p2, 800e18);
        PartialRepayShield l2 = new PartialRepayShield(IShieldPool(address(p2)), IShieldToken(address(bt)), address(u2), 1.1e18, 2_500, 50, 0, 0);
        CoreHarness k2 = new CoreHarness(address(l2), CONDITION_GAS);
        bt.mint(address(k2), 1_000e18);
        oracle.setPrice(1_080e18);
        k2.popCallerPays("", "", address(0xB0B));
        (, uint256 debt,,) = p2.position(address(u2));
        require(debt == 600e18, "rescue happened");
        (bool ok, bytes memory ret) = address(k2).call(abi.encodeWithSignature("rewardOwed(address,address)", address(bt), address(0xB0B)));
        require(ok && abi.decode(ret, (uint256)) == 1e18, "reward owed to the payer");
    }

    function test_thresholdMustExceedOne() public {
        try new PartialRepayShield(IShieldPool(address(pool)), IShieldToken(address(token)), address(user), 1e18, 2_500, 50, 0, 0) {
            revert("must refuse");
        } catch (bytes memory r) {
            require(bytes4(r) == PartialRepayShield.BadConfig.selector, "threshold <= 1.0 refused");
        }
    }

    function test_nonceKeyFitsCoreBudget() public {
        (bool ok, uint256 key) = k.nonceKey(""); // NONCE_KEY_GAS = 10,000, as Core
        require(ok && key != 0, "pool read within 10,000 gas");
    }

    function test_stakeConfig() public view {
        (address reg, uint256 amount, uint32 delay) = logic.popcornStakeConfig();
        require(reg == 0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F && amount == 0.02 ether && delay == 86_400, "stake config");
        require(logic.popcornMode() == 1, "sender-pays");
    }

    receive() external payable {}
}

/// CallerPays: the reward goes to the payer Core passed in, whatever popArgs says (fuzzed).
contract CallerPaysTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testFuzz_rewardOnlyToThePayer(address payer, address inPopArgs, bytes32 salt) public {
        if (uint160(payer) < 0x10000 || payer.code.length > 0 || payer == inPopArgs) payer = address(uint160(uint256(keccak256(abi.encode(salt, 1)))));
        if (uint160(inPopArgs) < 0x10000 || inPopArgs.code.length > 0) inPopArgs = address(uint160(uint256(keccak256(abi.encode(salt, 2)))));
        RewardRule l = new RewardRule();
        CoreHarness h = new CoreHarness(address(l), 20_000);
        vm.deal(address(h), 1 ether);
        (bool ok,) = address(h).call(abi.encodeWithSignature("arm()"));
        require(ok, "arm (forwarded)");
        uint256 b0 = payer.balance;
        uint256 c0 = inPopArgs.balance;
        h.popCallerPays(abi.encode(inPopArgs, salt), "", payer);
        require(payer.balance == b0 + l.BONUS(), "payer got the reward");
        require(inPopArgs.balance == c0, "the popArgs address got nothing");
        require(uint256(h.load(l.LAST_PAYER())) == uint256(uint160(payer)), "action saw the payer");
    }

    /// A payer contract that refuses ETH must not brick the rule contract: the action succeeds, the epoch advances,
    /// the reward is owed and the payer can claim it to another address.
    function test_payerRefusingEth_actionSucceeds_rewardOwedAndClaimable() public {
        RewardRule l = new RewardRule();
        CoreHarness h = new CoreHarness(address(l), 20_000);
        vm.deal(address(h), 1 ether);
        RefusingPayer rp = new RefusingPayer();
        (bool ok,) = address(h).call(abi.encodeWithSignature("arm()"));
        require(ok, "arm");
        h.popCallerPays("", "", address(rp));
        require(uint256(h.load(l.STATE())) >> 1 == 1, "epoch advanced (action did not revert)");
        require(address(rp).balance == 0, "refused");
        (bool o2, bytes memory r) = address(h).call(abi.encodeWithSignature("rewardOwed(address,address)", address(0), address(rp)));
        require(o2 && abi.decode(r, (uint256)) == l.BONUS(), "owed");
        // next round works: not bricked
        (ok,) = address(h).call(abi.encodeWithSignature("arm()"));
        h.popCallerPays("", "", address(rp));
        require(uint256(h.load(l.STATE())) >> 1 == 2, "second trigger");
        rp.claim(address(h), address(0), address(0xC1A1));
        require(address(0xC1A1).balance == 2 * l.BONUS(), "claimed both owed rewards to another address");
        (o2, r) = address(h).call(abi.encodeWithSignature("rewardOwed(address,address)", address(0), address(rp)));
        require(abi.decode(r, (uint256)) == 0, "cleared");
        try rp.claim(address(h), address(0), address(0xC1A1)) {
            revert("second claim must fail");
        } catch (bytes memory e) {
            require(bytes4(e) == CallerPays.NothingOwed.selector, "NothingOwed");
        }
    }

    function test_noPayerOutsideAction() public {
        RewardRule l = new RewardRule();
        CoreHarness h = new CoreHarness(address(l), 20_000);
        vm.deal(address(h), 1 ether);
        // __action with payer 0 (no Core payer): _payReward refuses
        try h.actionAs("", address(0)) {
            revert("must revert");
        } catch (bytes memory r) {
            require(bytes4(r) == CallerPays.NoPayer.selector, "NoPayer");
        }
    }
}
