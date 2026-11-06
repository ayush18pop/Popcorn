// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice What a check block says: no, yes, or unknown. Unknown means the check could not tell (a read reverted, ran out
///         of its gas cap or returned junk). Unknown never fires, not even under None Of: a broken read must not be
///         turned into "yes" by negation.
type Answer is uint8;

Answer constant NO = Answer.wrap(0);
Answer constant YES = Answer.wrap(1);
Answer constant UNKNOWN = Answer.wrap(2);

using {isYes, isNo, isUnknown} for Answer global;

function isYes(Answer a) pure returns (bool) {
    return Answer.unwrap(a) == 1;
}

function isNo(Answer a) pure returns (bool) {
    return Answer.unwrap(a) == 0;
}

function isUnknown(Answer a) pure returns (bool) {
    return Answer.unwrap(a) > 1;
}

/// @notice A bool as an answer (a check that cannot be unknown).
function answer(bool b) pure returns (Answer) {
    return b ? YES : NO;
}

/// @title Join
/// @notice The blocks that join checks: All Of, Any Of, None Of, At Least k Of n, Exactly One Of (and exactly k), and
///         If / Else. Same three-valued rules as the rule-set engine (src/rules/RuleSet.sol), so a check built in Solidity
///         and one built from data mean the same thing.
///
///           All Of      no if any child is no; otherwise unknown if any child is unknown; otherwise yes
///           Any Of      yes if any child is yes; otherwise unknown if any child is unknown; otherwise no
///           None Of     the opposite of Any Of, with unknown staying unknown
///           At Least k  yes once k children are yes; no once too few children are left that could still be yes
///           Exactly k   yes when exactly k are yes and none is unknown; no when more than k are yes or too few could be
///           If / Else   the "then" answer when the condition is yes, the "else" answer when it is no, unknown otherwise
library Join {
    function allOf(Answer a, Answer b) internal pure returns (Answer) {
        if (a.isNo() || b.isNo()) return NO;
        if (a.isUnknown() || b.isUnknown()) return UNKNOWN;
        return YES;
    }

    function anyOf(Answer a, Answer b) internal pure returns (Answer) {
        if (a.isYes() || b.isYes()) return YES;
        if (a.isUnknown() || b.isUnknown()) return UNKNOWN;
        return NO;
    }

    function noneOf(Answer a) internal pure returns (Answer) {
        if (a.isYes()) return NO;
        if (a.isNo()) return YES;
        return UNKNOWN;
    }

    function noneOf(Answer a, Answer b) internal pure returns (Answer) {
        return noneOf(anyOf(a, b));
    }

    function allOf(Answer[] memory xs) internal pure returns (Answer r) {
        r = YES;
        for (uint256 i; i < xs.length; i++) {
            if (xs[i].isNo()) return NO;
            if (xs[i].isUnknown()) r = UNKNOWN;
        }
    }

    function anyOf(Answer[] memory xs) internal pure returns (Answer r) {
        r = NO;
        for (uint256 i; i < xs.length; i++) {
            if (xs[i].isYes()) return YES;
            if (xs[i].isUnknown()) r = UNKNOWN;
        }
    }

    function noneOf(Answer[] memory xs) internal pure returns (Answer) {
        return noneOf(anyOf(xs));
    }

    function atLeast(uint256 k, Answer[] memory xs) internal pure returns (Answer) {
        (uint256 yes, uint256 unknown) = _count(xs);
        if (yes >= k) return YES;
        if (yes + unknown < k) return NO;
        return UNKNOWN;
    }

    function exactly(uint256 k, Answer[] memory xs) internal pure returns (Answer) {
        (uint256 yes, uint256 unknown) = _count(xs);
        if (yes > k || yes + unknown < k) return NO;
        if (unknown == 0) return YES; // yes == k
        return UNKNOWN;
    }

    function exactlyOne(Answer[] memory xs) internal pure returns (Answer) {
        return exactly(1, xs);
    }

    function ifElse(Answer cond, Answer then_, Answer else_) internal pure returns (Answer) {
        if (cond.isYes()) return then_;
        if (cond.isNo()) return else_;
        return UNKNOWN;
    }

    function list(Answer a, Answer b) internal pure returns (Answer[] memory xs) {
        xs = new Answer[](2);
        xs[0] = a;
        xs[1] = b;
    }

    function list(Answer a, Answer b, Answer c) internal pure returns (Answer[] memory xs) {
        xs = new Answer[](3);
        xs[0] = a;
        xs[1] = b;
        xs[2] = c;
    }

    function _count(Answer[] memory xs) private pure returns (uint256 yes, uint256 unknown) {
        for (uint256 i; i < xs.length; i++) {
            if (xs[i].isYes()) yes++;
            else if (xs[i].isUnknown()) unknown++;
        }
    }
}
