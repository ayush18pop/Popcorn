// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignedIntentCondition} from "src/conditions/SignedIntentCondition.sol";
import {XmssLib} from "src/signers/lib/XmssLib.sol";

/// @title XmssIntentCondition
/// @notice Standalone post-quantum stateful signed-intent trigger (XMSS/LMS-style, keccak256, our own construction: see XmssLib; NOT RFC 8391
///         and NOT NIST SP 800-208). Leaf q = ruleEpoch - xmssFirstEpoch < 2^xmssHeight. Bound to one chain id and one rule id (constructor). witness = salt ++ 67 chain values ++ height nodes.
abstract contract XmssIntentCondition is SignedIntentCondition {
    bytes32 public immutable xmssRoot;
    bytes32 public immutable xmssSeed;
    uint256 public immutable xmssFirstEpoch;
    uint256 public immutable xmssHeight;
    uint256 public immutable xmssChainId;
    uint256 public immutable xmssRuleId;

    constructor(bytes32 root, bytes32 seed, uint256 firstEpoch, uint256 height, uint256 chainId, uint256 ruleId) {
        xmssRoot = root;
        xmssSeed = seed;
        xmssFirstEpoch = firstEpoch;
        xmssHeight = height;
        xmssChainId = chainId;
        xmssRuleId = ruleId;
    }

    function _checkIntent(uint256 ruleId, uint256 epoch, bytes calldata popArgs, bytes calldata witness)
        internal
        view
        virtual
        override
        returns (bool)
    {
        if (block.chainid != xmssChainId || ruleId != xmssRuleId || epoch < xmssFirstEpoch) return false;
        return XmssLib.verify(xmssRoot, xmssSeed, xmssHeight, epoch - xmssFirstEpoch, _intentDigest(ruleId, epoch, popArgs), witness);
    }
}
