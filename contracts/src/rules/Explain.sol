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
interface IPopcornExplain {
    /// @return trigger the build's name for this trigger kind ("claim", "spend", ...); "unknown" if the data is not one
    /// @return nodes   the flow for this trigger with each node's result, evaluated on the current state
    function popcornExplain(bytes calldata popArgs, bytes calldata verifyData) external view returns (string memory trigger, FlowNode[] memory nodes);
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
}
