// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreHarness} from "test/CoreHarness.sol";
import {IPopcornExplain, FlowNode, Flow, FLOW_YES} from "src/rules/Explain.sol";

/// Every condition the build suites ask also asks the build's explain view, and requires the two to agree: the flow's
/// first action runs exactly when the condition is true. The flow must also be well formed (results 0..3, every input an
/// earlier node, every node labelled). The explain view may revert only where the condition is false (malformed data).
library ExplainCheck {
    function cond(CoreHarness h, bytes memory popArgs, bytes memory verifyData) internal returns (bool c) {
        c = h.condition(popArgs, verifyData);
        (bool ok, bytes memory ret) = address(h).staticcall(abi.encodeCall(IPopcornExplain.popcornExplain, (popArgs, verifyData)));
        if (!ok) {
            require(!c, "explain reverted where the condition holds");
            return c;
        }
        (, string memory spec, bytes memory results) = abi.decode(ret, (string, string, bytes));
        FlowNode[] memory n = Flow.parse(spec, results);
        require(n.length == results.length, "one result per node");
        require(n.length > 0, "empty flow");
        bool seenAction;
        bool runs;
        for (uint256 i; i < n.length; i++) {
            require(n[i].result <= 3, "result out of range");
            require(bytes(n[i].label).length > 0, "unlabelled node");
            for (uint256 j; j < n[i].inputs.length; j++) {
                require(n[i].inputs[j] < i, "an input must be an earlier node");
            }
            if (!seenAction && keccak256(bytes(n[i].kind)) == keccak256("action")) {
                seenAction = true;
                runs = n[i].result == FLOW_YES;
            }
        }
        require(runs == c, "the flow's verdict differs from the condition");
    }
}
