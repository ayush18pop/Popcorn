// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CallerPays} from "src/payers/CallerPays.sol";
import {FlowNode, Flow, IPopcornExplain, FLOW_YES} from "src/rules/Explain.sol";
import {answer} from "src/blocks/Answer.sol";

/// @title PaidCounter (the SDK README's caller-pays example)
/// @notice Same idea as ArmedCounter, but SENDER-PAYS (Core mode 1): every trigger has a separate PAYER (a searcher, a bot, any
///         funded wallet) who pays the gas, and the rule contract pays that payer a reward in ETH. The rule contract holds only the reward
///         money, never gas money. `_payReward` is best effort (a payer that refuses ETH is credited and claims later), so
///         the action never reverts because of the payer.
///
///         The reward is `reward` wei, paid from the rule contract's balance; if the balance is lower the payer is credited
///         (`rewardOwed`) instead. Condition reads only the rule contract's own storage.
contract PaidCounter is CallerPays, IPopcornExplain {
    bytes32 private constant COUNT = keccak256("popcorn.example.paidCounter.count");
    bytes32 private constant ARMED = keccak256("popcorn.example.paidCounter.armed");

    uint256 public immutable reward;

    event Popped(uint256 count, address payer);

    constructor(uint256 reward_) {
        reward = reward_;
    }

    function arm() external forwarded {
        _sstore(ARMED, 1);
    }

    function count() external view forwarded returns (uint256) {
        return _sload(COUNT);
    }

    function nonceKey() internal view override returns (uint256) {
        return uint256(keccak256(abi.encode("paid-counter", _sload(COUNT))));
    }

    function condition() internal view override returns (bool) {
        return _sload(ARMED) == 1;
    }

    function action(bytes calldata, address payer_) internal override {
        uint256 c = _sload(COUNT) + 1;
        _sstore(COUNT, c);
        _sstore(ARMED, 0);
        emit Popped(c, payer_);
        uint256 pay = address(this).balance < reward ? address(this).balance : reward;
        _payReward(address(0), pay);
    }

    function popcornExplain(bytes calldata, bytes calldata) external view returns (string memory trigger, FlowNode[] memory n) {
        trigger = "count";
        n = new FlowNode[](4);
        n[0] = Flow.node("trigger", "", "Count: no data; anyone can send it with a payer", FLOW_YES, Flow.none());
        n[1] = Flow.node("payer", "caller-pays", "the payer named in the transaction pays the gas", FLOW_YES, Flow.from(0));
        bool armed = _sload(ARMED) == 1;
        n[2] = Flow.node("condition", "", "the counter is armed (its owner called arm)", Flow.result(answer(armed)), Flow.from(0));
        n[3] = Flow.node("action", "", "count + 1, disarm, reward the payer", Flow.runs(armed), Flow.from(2));
    }
}

/// @notice PaidCounter that stakes itself (RuleStake's built-in stake trigger) so the alt mempool (ERC-8421 sidecar) lets its
///         condition read OTHER contracts' storage and the VERIFY budget grows to 2.5M. This example does not need that; it
///         shows the one override a rule contract needs. Deploy with `stake: true`, caps maxTriggerDataLength >= 32,
///         maxGasPerFrame >= 80,000 and maxStateGasPerFrame >= 3 fresh slots (3 * 97,920).
contract StakedPaidCounter is PaidCounter {
    constructor(uint256 reward_) PaidCounter(reward_) {}

    function _stakeConfig() internal view override returns (address, uint256, uint32) {
        return (DEVNET_STAKING_REGISTRY, 0.02 ether, 86_400);
    }
}
