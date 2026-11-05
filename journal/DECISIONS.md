# Decisions

Each entry records a decision the team made, the options we weighed, and why we chose what we did. New entries are
added at the bottom as decisions are made.

---

## 1. Position Popcorn as "OpenZeppelin for frame transactions", focused on DeFi safety

**Context.** EIP-8141 lets any contract approve and pay for its own transactions. That is as big a change as ERC-20
was, and every team building on it will need the same safety-critical parts.

**Options.** (a) Keeper-free automation as the product. (b) A single DeFi security product. (c) A library of reviewed
building blocks, with DeFi safety as the main focus.

**Choice.** (c). Automation and the security products are things you build *with* the library.

**Why.** A library has to match OpenZeppelin's breadth to earn the name, so every module family is build work, not a
roadmap slide. Keeping DeFi safety as the focus gives the library a clear first audience: protocol teams.

## 2. A condition authorises the transaction, not a key

**Context.** A rule contract must be able to act when something becomes true, without anyone holding its key.

**Choice.** The rule contract's VERIFY frame approves its own transaction only when its condition holds. Anyone can
send it, even from a wallet with 0 ETH. A false condition makes the transaction invalid, so a failed attempt costs
the sender nothing.

**Why.** No key means nothing to leak, rotate or quantum-break, and no trusted keeper.

## 3. One hardened account code (Core) under every rule contract

**Context.** A contract that pays for transactions strangers build is easy to drain if written naively: extra frames
it pays for, inflated fees, replayed events, re-entry into its action.

**Choice.** Popcorn Core, written in Yul, sits under every rule contract and accepts exactly one frame layout, caps
fees, lets each event fire once through an EIP-8250 nonce key, and locks re-entry into the action. Developers write
only the logic.

**Why.** These checks are easy to get subtly wrong, and every rule contract needs all of them. Writing them once, in
one small reviewed code base, is the point of a library.

## 4. Two payment modes: rule pays, or caller pays and earns a reward

**Options.** Only the rule contract pays; only the caller pays; both.

**Choice.** Both. In rule-pays mode the rule contract approves execution and payment. In caller-pays mode it approves
execution only, a separate payer pays, and the reward goes to whoever actually paid (read from the payer's frame,
never from data a copier could change).

**Why.** Protective actions (pausing a vault) should cost the triggerer nothing. Market-style actions (repaying a loan
for a bonus) work better when the caller pays and is paid.

## 5. The owner key is hybrid ECDSA + WOTS+

**Choice.** Owner actions (unpause, reconfigure, rotate keys, withdraw stake) need both an ECDSA signature and a WOTS+
hash-based signature over the same transaction hash, with two-step key rotation.

**Why.** Triggers carry no signature at all. The one key left should stay safe after quantum computers, while still
working with today's wallets.

## 6. Zero-knowledge and post-quantum are separate claims

**Choice.** We describe Groth16 proofs as zero-knowledge and never as post-quantum. Post-quantum claims cover only
hash-based and lattice signatures (WOTS+, FORS, XMSS, SPHINCS+, Falcon) and keyless triggers.

**Why.** Groth16 relies on pairings, which a quantum computer could break. Mixing the two claims would be wrong.

## 7. Time triggers are not part of the library

**Context.** Deadline, inactivity and valid-until triggers need the current time during validation.

**Choice.** Not built. Validation has no usable clock: `TIMESTAMP` and `NUMBER` are banned in the validation prefix,
and recent-root workarounds need someone to publish a root.

**Why.** A trigger we cannot make sound should not ship.

## 8. Rule sets evaluate in three values and fail closed

**Choice.** Each leaf of a condition tree is true, false or unknown. A leaf that reverts, runs out of its own gas cap or
returns the wrong size is unknown, and unknown never makes a rule fire, including under NOT.

**Why.** Treating a broken read as "false" is unsound under negation: NOT(broken oracle) would fire. Failing closed is
the only safe default for code that can move funds.

## 9. Plain names for everything a developer touches

**Choice.** Rule contract (not kernel), condition, signer, trigger (not pop), reward (not bonus), rule-pays and
caller-pays. Core's on-chain entry points keep their compiled selectors, so the rename does not change reviewed
bytecode.

**Why.** A developer should understand what a function does from its name, without learning our vocabulary first.
