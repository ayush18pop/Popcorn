// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Answer} from "src/blocks/Answer.sol";

/// @notice One node of a build's flow, as the explorer draws it: which block it is, what it says, its result for a trigger,
///         and which nodes feed it.
///   kind    "trigger", "payer", "condition", "operator" or "action"
///   blockId the catalog id of the block (docs/catalog), or "" for a check of the build's own (e.g. "account is set up")
///   label   one line for a developer
///   result  FLOW_NO, FLOW_YES, FLOW_UNKNOWN (a read failed: never fires) or FLOW_SKIPPED (not reached: an earlier node
///           already decided). For an action, FLOW_YES means it runs for this trigger.
///   inputs  indexes of the nodes that feed this one
struct FlowNode {
    string kind;
    string blockId;
    string label;
    uint8 result;
    uint8[] inputs;
}

uint8 constant FLOW_NO = 0;
uint8 constant FLOW_YES = 1;
uint8 constant FLOW_UNKNOWN = 2;
uint8 constant FLOW_SKIPPED = 3;

/// @notice What a build implements so that any of its triggers can be explained, node by node, from the chain alone:
///         `popcornExplain` runs the same blocks, in the same order, as the build's condition, with the same short-circuits,
///         and reports every node. It is an ordinary forwarded view (call it on the build's address with eth_call), never
///         part of validation. It must not change what the condition decides; each build's tests check that the flow's
///         verdict equals the condition's.
///
///         The flow comes back compact (a build's logic must deploy under the transaction gas cap, and returning an array
///         of structs costs kilobytes of encoder code): `flow` is the nodes as "kind|blockId|label|inputs" separated by ';'
///         (kind t trigger, p payer, c condition, o operator, a action; inputs comma-separated node indexes), and
///         `results` holds one byte per node (FLOW_NO, FLOW_YES, FLOW_UNKNOWN, FLOW_SKIPPED). Flow.parse turns them into
///         FlowNode[]; the SDK's inspector does the same.
interface IPopcornExplain {
    /// @return trigger the build's name for this trigger kind ("claim", "spend", ...); "unknown" if the data is not one
    /// @return flow    the nodes, in the format above
    /// @return results one result per node, evaluated on the current state
    function popcornExplain(bytes calldata popArgs, bytes calldata verifyData) external view returns (string memory trigger, string memory flow, bytes memory results);
}

library Flow {
    function node(string memory kind, string memory blockId, string memory label, uint8 result, uint8[] memory inputs)
        internal
        pure
        returns (FlowNode memory)
    {
        return FlowNode(kind, blockId, label, result, inputs);
    }

    function result(Answer a) internal pure returns (uint8) {
        return Answer.unwrap(a);
    }

    /// @notice The result of a node that runs only if every earlier node in a short-circuited chain said yes.
    function after_(bool reached, Answer a) internal pure returns (uint8) {
        return reached ? Answer.unwrap(a) : FLOW_SKIPPED;
    }

    function runs(bool go) internal pure returns (uint8) {
        return go ? FLOW_YES : FLOW_SKIPPED;
    }

    function none() internal pure returns (uint8[] memory) {
        return new uint8[](0);
    }

    function from(uint8 a) internal pure returns (uint8[] memory x) {
        x = new uint8[](1);
        x[0] = a;
    }

    function from(uint8 a, uint8 b) internal pure returns (uint8[] memory x) {
        x = new uint8[](2);
        x[0] = a;
        x[1] = b;
    }

    function from(uint8 a, uint8 b, uint8 c) internal pure returns (uint8[] memory x) {
        x = new uint8[](3);
        x[0] = a;
        x[1] = b;
        x[2] = c;
    }

    function from(uint8 a, uint8 b, uint8 c, uint8 d) internal pure returns (uint8[] memory x) {
        x = new uint8[](4);
        x[0] = a;
        x[1] = b;
        x[2] = c;
        x[3] = d;
    }

    /// @notice Builds a flow from a compact description and the results, so a build's flow is data, not code (code size
    ///         matters: a build's logic must deploy under the transaction gas cap). The description is nodes separated by
    ///         ';', each "kind|blockId|label|inputs" with kind t (trigger), p (payer), c (condition), o (operator) or a
    ///         (action), and inputs as comma-separated node indexes ("" for none). `results[i]` is node i's result.
    function parse(string memory spec, bytes memory results) internal pure returns (FlowNode[] memory nodes) {
        bytes memory b = bytes(spec);
        uint256 count = 1;
        for (uint256 i; i < b.length; i++) {
            if (b[i] == ";") count++;
        }
        nodes = new FlowNode[](count);
        uint256 p;
        for (uint256 n; n < count; n++) {
            string[4] memory f;
            for (uint256 k; k < 4; k++) {
                uint256 start = p;
                while (p < b.length && b[p] != "|" && b[p] != ";") p++;
                f[k] = string(_slice(b, start, p));
                if (p < b.length && (b[p] == "|" || k == 3)) p++;
            }
            nodes[n] = FlowNode(_kind(bytes(f[0])), f[1], f[2], uint8(results[n]), _inputs(bytes(f[3])));
        }
    }

    function _kind(bytes memory k) private pure returns (string memory) {
        if (k.length == 1) {
            if (k[0] == "t") return "trigger";
            if (k[0] == "p") return "payer";
            if (k[0] == "c") return "condition";
            if (k[0] == "o") return "operator";
            if (k[0] == "a") return "action";
        }
        return string(k);
    }

    function _inputs(bytes memory s) private pure returns (uint8[] memory out) {
        if (s.length == 0) return new uint8[](0);
        uint256 count = 1;
        for (uint256 i; i < s.length; i++) {
            if (s[i] == ",") count++;
        }
        out = new uint8[](count);
        uint256 j;
        for (uint256 i; i < s.length; i++) {
            if (s[i] == ",") j++;
            else out[j] = out[j] * 10 + (uint8(s[i]) - 48);
        }
    }

    function _slice(bytes memory b, uint256 start, uint256 end) private pure returns (bytes memory out) {
        out = new bytes(end - start);
        for (uint256 i; i < out.length; i++) {
            out[i] = b[start + i];
        }
    }
}
