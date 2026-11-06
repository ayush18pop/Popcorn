# Decisions

Each entry records a decision the team made, the options we weighed, and why we chose what we did. New entries are
added at the bottom as decisions are made.

---

## 1. Core runs the rule contract's logic by DELEGATECALL inside VERIFY

**Options.** STATICCALL the logic as a separate contract, or DELEGATECALL it.

**Choice.** DELEGATECALL, so the condition runs in the rule contract's own storage.

**Why.** A condition that reads only the rule contract's own storage counts as the sender's storage, which the public
mempool accepts without stake. A STATICCALL into a separate contract would read another contract's storage.

## 2. Every call from Core into the logic gets a fixed amount of gas

**Choice.** `__nonceKey` gets exactly 10,000 gas and `__condition` gets the rule contract's `conditionGas`; never `gas()`.

**Why.** Validation must be bounded. A condition must not be able to consume whatever the caller declared.

## 3. Trigger data travels in the SENDER frame and is read in VERIFY

**Choice.** The trigger data (`popArgs`) is the SENDER frame's calldata. VERIFY reads it with `FRAMEDATACOPY`, so the
condition and the action see the same bytes.

**Why.** One copy of the data, and no way for the action to run with different inputs than the condition checked.

## 4. The payer is read from the payer's own VERIFY frame

**Context.** The transaction parameter that names the payer is not available on the reference client.

**Choice.** In caller-pays mode Core reads the payer as the target of the payer's VERIFY frame
(`FRAMEPARAM(0x00, 1)`); in rule-pays mode the payer is the rule contract itself.

**Why.** The payer is then whoever actually approved and paid, never an address taken from data a copier could change.

## 5. Proofs go in VERIFY data; owner signatures go in signature entries

**Context.** The signature hash covers every frame's data, VERIFY data included; only the bytes of signature entries
with an empty message are excluded.

**Choice.** A proof sits in VERIFY data, where it is bound to the transaction. Owner signatures sit in ARBITRARY
signature entries, which the hash they sign does not cover.

**Why.** A signature cannot sign over itself; a proof should be bound to everything else in the transaction.

## 6. Templates avoid creating storage in their actions

**Context.** Each new storage slot costs 97,920 state gas.

**Choice.** Core caps the state gas of the action frame, and templates write to slots that already exist where they can.

**Why.** State gas is the largest cost of an action and the easiest to underestimate.

## 7. Rewards are bound to the payer or to a proof, never to a name in the trigger data

**Context.** A pending trigger carries no signature, so anyone can replace it by paying 10% more and change its data.

**Choice.** Rewards go to the account that paid the gas (caller-pays) or to a recipient bound inside a proof. A reward to
an address named in the trigger data is documented as copyable.

**Why.** Otherwise a mempool watcher can copy a trigger, put in its own address and take the reward.

## 8. The rule contract's settings are 101 bytes of immutable arguments

**Choice.** Logic, mode, fee caps, per-frame gas and state-gas caps, a verifier slot, `conditionGas`, and the maximum
sizes of VERIFY data and trigger data are appended to Core's code at deployment.

**Why.** Immutable, cheap to read with `CODECOPY`, and nothing to initialise or upgrade.

## 9. The action frame's gas limits are pinned to the caps

**Options.** Accept any SENDER frame limit up to the cap, or require exactly the cap.

**Choice.** Exactly the cap (execution and state); VERIFY's state limit must be 0.

**Why.** Anyone can build a trigger. With "up to the cap", a griefer could set the action's gas to zero: VERIFY approves,
the key is consumed, the rule contract pays, and the action never runs. Unused gas is refunded, so pinning costs nothing.

## 10. A transient lock stops the action from running twice

**Choice.** Core sets a transient lock before calling the action; any re-entry into the action path reverts.

**Why.** Logic that calls its own rule contract with trigger calldata would otherwise run the action a second time.

## 11. A VERIFY gas floor stops conditions from failing open

**Context.** A condition that treats a failed sub-call as "true" could be made to pass by a caller who declares too
little VERIFY gas. Core cannot read `GAS` in validation.

**Choice.** Core requires the declared VERIFY limit to be at least
`10,000 + conditionGas + conditionGas/63 + 7,000 + data`, so the condition always gets its full budget.

**Why.** The condition's gas must not be something a caller controls.

## 12. The factory pins Core's code hash and bounds every argument

**Choice.** `RuleFactory` accepts only the Core build whose creation-code hash it pins, and refuses unsafe arguments:
zero or huge fee caps, frame gas over the transaction cap, a `conditionGas` the VERIFY floor cannot fit, oversized data
limits, and staking settings the action cannot afford.

**Why.** Most ways to deploy a broken rule contract are argument mistakes. Catching them at deployment is cheap.

## 13. Rule contracts stake themselves with a built-in stake trigger

**Context.** The staking registry keys stake by `msg.sender`, so a rule contract must call it itself.

**Choice.** A built-in stake trigger that calls `addStake` from the rule contract, limited to two paid attempts, after
which only the owner can re-enable it.

**Why.** Rule contracts that read other contracts need stake on the alternative mempool, and nothing else can stake for
them. Limiting attempts stops strangers from draining the rule contract with failed stake triggers.

## 14. Nonce keys come from state the action advances

**Choice.** A rule's key is derived from an epoch or counter the action moves forward, never from trigger data alone.
The helper that hashes trigger data into a key is domain-separated and documented as safe only when each trigger can be
valid once by construction.

**Why.** The number of distinct valid keys is the number of transactions anyone can make the rule contract pay for.

## 15. "Can it trigger?" means simulating the exact transaction

**Options.** Call `__condition` with `eth_call`, or simulate the whole frame transaction.

**Choice.** The SDK simulates the exact transaction it would send.

**Why.** That covers the key, the condition, the caps, the gas floor, the balance and the nonce, the way inclusion
does. A plain call of the condition misses most of the ways a transaction fails.

## 16. Rule contracts are recognised by their code shape

**Choice.** The SDK identifies a rule contract by its code (a known Core runtime followed by 101 bytes of arguments),
not by how it answers calls.

**Why.** Ordinary calls are forwarded to the logic, so behaviour says nothing reliable about what the contract is.

## 17. Ordinary calls are forwarded to the logic

**Context.** Without it, only the action could write a rule contract's storage, so a vault built as a rule contract
could not take deposits.

**Choice.** Any ordinary call with a selector is DELEGATECALLed to the logic, except the reserved hooks, and never while
the action runs.

**Why.** It lets a protocol *be* a rule contract and keep its conditions on its own storage, which is what the public
mempool accepts.

## 18. The action path runs only in the rule contract's own transaction

**Context.** A forwarded function that calls its own rule contract from inside another account's frame transaction could
reach the action path.

**Choice.** Core requires `tx.sender` to be the rule contract and the executing frame to be the transaction's own SENDER
frame before running the action.

**Why.** Without it, the action could run with no VERIFY, no key and no condition, repeatedly.

## 19. One vault logic, two deployments

**Choice.** The guarded vault's pause-only and bounty profiles deploy the same logic as two rule contracts with
different `conditionGas`.

**Why.** `conditionGas` sets the VERIFY floor, so a cheap pause rule and an expensive proof check cannot share one
deployment, but they should share one audited logic.

## 20. A paused vault can only be reopened when it is safe again

**Choice.** The owner can top up assets while paused, and `unpause` requires the invariant to hold.

**Why.** Otherwise a broken vault could be reopened broken, paused again, and pay a reporter reward on every cycle.

## 21. A local devnet is a second test target, not a replacement

**Choice.** A local copy of the public devnet stack, on its own chain id, with deterministic contract addresses and
per-entity validation budgets. The public devnet stays the reference.

**Why.** Some rules (reading other contracts, large proofs) cannot be included on the public devnet's current limits. A
separate chain id makes sure nothing signed for one network is valid on the other.

## 22. Validation budgets target 250k unstaked and 2.5M staked

**Context.** The ERC-8421 draft says 100k / 1M per entity; the organisers' published values are 250k / 2.5M.

**Choice.** Design and test against 250k / 2.5M, and state the draft's numbers as a limit.

**Why.** Those are the values the alternative mempool's own documentation describes, and they decide whether ZK proof
checks and post-quantum signatures fit at all.

## 23. Caller-pays mode does not use fee caps, and the factory checks the declared mode

**Choice.** In caller-pays mode the rule contract never approves payment, so fee caps are unused and must be zero. A logic
declares its mode, and the factory refuses a deployment in the other mode.

**Why.** A caller-pays logic deployed in rule-pays mode would pay the gas itself and refuse to pay its own reward.

## 24. Actions never revert for reasons the payer controls

**Context.** A payer that refuses ETH could make the reward payment revert after the key was consumed, bricking a rule
whose key only advances in its action.

**Choice.** Actions advance their key state first and pay rewards best effort: on failure the reward is recorded as owed
and can be claimed later.

**Why.** The key is consumed before the action runs, so an action that reverts loses the rule's next step for good.

## 25. The repay shield keys on its own rescue epoch

**Context.** Keying on the lending pool's position nonce let anyone void pending rescues with a 1-wei repayment.

**Choice.** The shield keeps its own rescue epoch and bumps it first in every action.

**Why.** A key that strangers can move is a free way to cancel someone's protection.

## 26. The payer's placeholder signature entry carries a message

**Context.** A signature entry with an empty message is left out of the signature hash, so anyone could pad it and
raise the payer's gas.

**Choice.** The placeholder entry carries a fixed 32-byte message, so the payer's signature covers its bytes.

**Why.** Every byte the payer pays for should be bytes the payer signed.

## 27. Bounty claims are protected by re-proving, not by a snapshot (yet)

**Context.** The exploit proof binds the vault's live state, so any deposit makes a pending claim invalid.

**Choice.** Re-prove against the new state (under a second). A per-epoch snapshot word is the stronger design; it is
recorded, not built.

**Why.** The fix is cheap for whitehats today; the snapshot changes the vault and the circuit together.

## 28. `simulate()` never sends anything by default

**Choice.** `simulate()` predicts each mempool's verdict from the reference client's simulation, the stake and the
budgets, and says the alternative mempool's verdict is predicted. Asking the sidecar itself is opt-in, with a warning,
because a sidecar that admits a transaction may also include it. Only `trigger()` sends.

**Why.** A tool that answers "would this be accepted?" must not quietly execute the transaction.

## 29. The owner's one-time keys are spent in their own frame

**Choice.** An owner transaction is `[VERIFY, SENDER ownerBump(), SENDER owner(call)]`. Core accepts any WOTS+ leaf at
or above the stored index; the bump frame spends it and commits on its own; the call runs only if the bump succeeded.

**Why.** If the leaf were spent inside the call, a failing call would roll the spend back, and a dropped signature
could never be skipped. A one-time key must be spent even when the call fails.

## 30. Owner calls are marked by a transient flag, and key rotation is two-step

**Choice.** Core sets an owner flag only around the owner call, which `onlyOwnerCall` functions check. Rotation stages
the new keys; the old keys stay valid until a transaction signed by the new keys finalises the rotation.

**Why.** A typo in a new key, root or seed must not lock the owner out.

## 31. One EIP-712 digest for every signature scheme

**Choice.** Every signer verifies the same typed-data digest, naming the chain, the rule contract, the rule, its epoch
and the hash of the trigger data.

**Why.** Wallets can sign it with `eth_signTypedData_v4`, and one digest means one place to get replay binding right.

## 32. Replay protection lives in the rule contract, not in the signature

**Choice.** Each rule keeps an epoch in the rule contract's storage; the key derives from it and the action advances it
first. Hash-based one-time keys use leaf = epoch − first epoch.

**Why.** A one-time signature scheme is only safe if each leaf signs once, and the epoch makes that a property of the
contract, not of the signer's good behaviour.

## 33. One-time keys never sign twice, even with a different salt

**Choice.** The SDK signers record each signed digest before returning the signature, refuse a second digest on the
same leaf, and refuse to sign beyond a few-time scheme's budget.

**Why.** A second message on a one-time leaf leaks enough to forge signatures.

## 34. Post-quantum schemes are our own implementations, except Falcon

**Choice.** FORS, XMSS-style and SPHINCS+-style signers are our own keccak constructions, with no code copied from
sources without a clear licence. Falcon-512 uses ZKNox's ETHFALCON verifier, vendored unchanged under its MIT licence.

**Why.** We can only ship what we may legally ship, and we label the keccak variants as not the NIST encodings.

## 35. Inline conditions for the public budget

**Context.** Calling a signer contract costs about 9–10k extra VERIFY gas.

**Choice.** Offer inline conditions (ECDSA, WOTS+, FORS, XMSS) that keep the key as immutables, next to the generic
signer-based condition. The WOTS+ signer grinds its salt for a cheap digest.

**Why.** That is what makes a post-quantum signature fit the public mempool's 100k budget.

## 36. P-256 checks enforce low-s and fail closed without the precompile

**Choice.** The P-256 signer rejects high-s signatures (the precompile accepts both) and treats a missing precompile as
"not signed".

**Why.** Signature malleability and a missing precompile must never turn into a valid signature.

## 37. Rule-set configurations are stored as code

**Options.** Logic immutables, rule contract storage, configuration baked into a per-config logic, or a shared logic
reading a published configuration.

**Choice.** A shared logic. The configuration is validated by `RuleSetPublisher` and deployed as a contract's code at a
CREATE2 address derived from its bytes; the rule contract holds a pointer to it.

**Why.** A new rule contract costs a small data contract instead of a new logic deployment, the configuration is
immutable, and a rule contract can only run a configuration the publisher accepted.

## 38. Every rule has its own key, epoch and fire limit

**Choice.** A rule's key is `keccak(domain, ruleId, epoch)`; the action advances the epoch first; `maxFires` closes a
rule after a number of fires.

**Why.** Rules in one contract must fire independently, and each must fire exactly once per event.

## 39. Rule-set actions are best-effort calls

**Choice.** An action is nothing, or one call with a gas cap. A failed call is reported in an event, never reverted.

**Why.** The key is consumed before the action runs; a reverting action would lose the rule's next step.

## 40. Every external read in a rule set has its own gas cap

**Choice.** Each leaf that reads another contract or calls a condition gets its own STATICCALL gas cap. A rule's mempool
class is its strictest leaf's.

**Why.** One misbehaving target must not starve the rest of the tree, and developers need to know which leaf forces
stake.

## 41. Popcorn Guard is the flagship product, with a UI, CLI, SDK and Claude skills

**Choice.** A protocol stops itself when its own rules break, with no pause key and no keeper. The team ships it as a
UI, a command-line tool, the SDK and Claude skills.

**Why.** It is the clearest use of the library for the audience we chose, and each surface serves a different kind of
developer.

## 42. Position Popcorn as "OpenZeppelin for frame transactions", focused on DeFi safety

**Context.** EIP-8141 lets any contract approve and pay for its own transactions. That is as big a change as ERC-20
was, and every team building on it will need the same safety-critical parts.

**Options.** (a) Keeper-free automation as the product. (b) A single DeFi security product. (c) A library of reviewed
building blocks, with DeFi safety as the main focus.

**Choice.** (c). Automation and the security products are things you build *with* the library.

**Why.** A library has to match OpenZeppelin's breadth to earn the name, so every module family is build work, not a
roadmap slide. Keeping DeFi safety as the focus gives the library a clear first audience: protocol teams.

## 43. A condition authorises the transaction, not a key

**Context.** A rule contract must be able to act when something becomes true, without anyone holding its key.

**Choice.** The rule contract's VERIFY frame approves its own transaction only when its condition holds. Anyone can
send it, even from a wallet with 0 ETH. A false condition makes the transaction invalid, so a failed attempt costs
the sender nothing.

**Why.** No key means nothing to leak, rotate or quantum-break, and no trusted keeper.

## 44. One hardened account code (Core) under every rule contract

**Context.** A contract that pays for transactions strangers build is easy to drain if written naively: extra frames
it pays for, inflated fees, replayed events, re-entry into its action.

**Choice.** Popcorn Core, written in Yul, sits under every rule contract and accepts exactly one frame layout, caps
fees, lets each event fire once through an EIP-8250 nonce key, and locks re-entry into the action. Developers write
only the logic.

**Why.** These checks are easy to get subtly wrong, and every rule contract needs all of them. Writing them once, in
one small reviewed code base, is the point of a library.

## 45. Two payment modes: rule pays, or caller pays and earns a reward

**Options.** Only the rule contract pays; only the caller pays; both.

**Choice.** Both. In rule-pays mode the rule contract approves execution and payment. In caller-pays mode it approves
execution only, a separate payer pays, and the reward goes to whoever actually paid (read from the payer's frame,
never from data a copier could change).

**Why.** Protective actions (pausing a vault) should cost the triggerer nothing. Market-style actions (repaying a loan
for a bonus) work better when the caller pays and is paid.

## 46. The owner key is hybrid ECDSA + WOTS+

**Choice.** Owner actions (unpause, reconfigure, rotate keys, withdraw stake) need both an ECDSA signature and a WOTS+
hash-based signature over the same transaction hash, with two-step key rotation.

**Why.** Triggers carry no signature at all. The one key left should stay safe after quantum computers, while still
working with today's wallets.

## 47. Zero-knowledge and post-quantum are separate claims

**Choice.** We describe Groth16 proofs as zero-knowledge and never as post-quantum. Post-quantum claims cover only
hash-based and lattice signatures (WOTS+, FORS, XMSS, SPHINCS+, Falcon) and keyless triggers.

**Why.** Groth16 relies on pairings, which a quantum computer could break. Mixing the two claims would be wrong.

## 48. Time triggers are not part of the library

**Context.** Deadline, inactivity and valid-until triggers need the current time during validation.

**Choice.** Not built. Validation has no usable clock: `TIMESTAMP` and `NUMBER` are banned in the validation prefix,
and recent-root workarounds need someone to publish a root.

**Why.** A trigger we cannot make sound should not ship.

## 49. Rule sets evaluate in three values and fail closed

**Choice.** Each leaf of a condition tree is true, false or unknown. A leaf that reverts, runs out of its own gas cap or
returns the wrong size is unknown, and unknown never makes a rule fire, including under NOT.

**Why.** Treating a broken read as "false" is unsound under negation: NOT(broken oracle) would fire. Failing closed is
the only safe default for code that can move funds.

## 50. Plain names for everything a developer touches

**Choice.** Rule contract (not kernel), condition, signer, trigger (not pop), reward (not bonus), rule-pays and
caller-pays. Core's on-chain entry points keep their compiled selectors, so the rename does not change reviewed
bytecode.

**Why.** A developer should understand what a function does from its name, without learning our vocabulary first.

## 51. Build only what needs no devnet change, or only a gas-limit change

**Context.** Several frame-transaction proposals (ASSERT frames, commit-reveal, expiring nonces, the canonical
recent-root frame) would need new client or mempool features before anything built on them could run.

**Choice.** Build only modules that run on the devnet as it is, or that need nothing more than higher validation gas
limits. Every gas-limit change we make on our own devnet comes with its reason.

**Why.** Everything we ship should run end to end today, on infrastructure anyone can reproduce.

## 52. The developer site is example-based, not a visual editor

**Options.** A node-based workflow editor for building frame transactions, or a site built around worked examples.

**Choice.** A developer site: every module has its own page, and every example plays step by step, frame by frame,
from recorded real runs (the simulation trace, the mempool's admission report and the receipt). An explorer, a page per
Claude skill and an MCP server sit alongside it.

**Why.** Developers adopt a library by seeing a module work and copying it. Driving every animation from a recorded
run keeps the site honest about what actually happened on chain.

## 53. The SDK ships exactly one Core build

**Choice.** The SDK carries a single Core artifact, pinned to the creation-code hash the factory accepts, and recognises
rule contracts only by that build's code.

**Why.** One build means one set of checks to trust. A rule contract on any other code is not treated as a Popcorn rule
contract.

## 54. The signed-intent typed data keeps the field name popArgsHash

**Options.** Rename the EIP-712 field to triggerDataHash, or keep popArgsHash.

**Choice.** Keep popArgsHash. It is the hash of Core's popArgs parameter, which the documentation describes as the
trigger data.

**Why.** The field name is part of what wallets sign. Renaming it would change every intent digest and every committed
signature vector, including the post-quantum ones, for no gain in safety.

## 55. The SDK is tested against an independent reference

**Choice.** The SDK's offline tests compare its argument encoder and trigger builder, byte for byte, with a separate
reference implementation that reads the argument layout from contracts/core/LAYOUT.md and builds triggers from first
principles.

**Why.** A builder tested only against itself can be consistently wrong. A second implementation written from the
specification catches drift between the documentation, Core and the SDK.

## 56. The developer site is a static app in apps/web, outside the Bun workspace for now

**Choice.** A Vite, React and Tailwind app in `apps/web`, with its own npm lockfile. It imports `@popcorn/simulator` and
the SDK's transport module straight from their sources.

**Why.** A static bundle needs no backend and can be hosted anywhere. Keeping it out of the workspace leaves `bun.lock`
and the package builds untouched while the site settles; joining the workspace later is a lockfile change, not a rewrite.

## 57. The module catalog lives in docs/catalog, one file per module

**Choice.** `docs/catalog/<corner>/<module>.md`: front matter for the facts the site filters and badges on (corner,
trigger, status, mempool, gas, example, related, code), and Markdown sections for the page (what it does, when it fires,
what it does then, mempool, code, limits). The site parses these files and restates nothing.

**Why.** One source for the site, the planned Claude skills and the MCP server's `list_modules` / `get_module`. A module
page cannot disagree with the catalog because it is the catalog.

## 58. Gas is "not measured yet" until a run measures it

**Choice.** A module's `gas` is null unless a recorded run measured it (tagged `measured` with the network) or a
contract documents an estimate (tagged `estimated`). The site shows null as "not measured yet" and never fills a bar
from a guess.

**Why.** The whole point of the gas section is to decide which mempool a module fits. A made-up number there is worse
than no number.

## 59. Sample runs in the recorder's format until the recorder exists

**Context.** The player replays `examples/<corner>/<module>/run.json`, which the recorder script will write from a
devnet. The recorder is not built yet.

**Choice.** Four sample runs (guarded vault, partial repay shield, proof-of-exploit bounty, rule-pays counter) in exactly
the recorder's format, with `recorded: false` and a note saying which values come from the contracts and which are
placeholders. The player labels them "sample run" on screen. The recorder replaces each file in place.

**Why.** The player, the module pages and the format can be built and reviewed now, and nothing about the switch to
recorded data changes the site.

## 60. The site reuses only the browser-safe parts of the SDK

**Context.** The SDK's main entry reads files (one-time key records) and its Core artifacts are generated at build
time, so it does not load in a browser as is.

**Choice.** The site imports the simulator's rule table and the SDK's transport (devnet table, JSON-RPC, receipts,
admission status) by path. The explorer decodes the 101 argument bytes itself from `contracts/core/LAYOUT.md`, and
compares the Core build only when `contracts/core/build.sh` ran before the site was built; otherwise it says it did not.
Live `canTrigger` waits for a browser entry in the SDK and points to the CLI meanwhile.

**Why.** Reuse what already runs in a browser rather than reimplement it, and be explicit about the one check the
browser cannot make yet.

## 61. The player's world view is a diagram

**Options.** A diagram or a lightweight 3D scene.

**Choice.** A diagram: the caller, the rule contract, the mempool and the budget bar, then before and after values.

**Why.** It reads at phone width, works with reduced motion, and every element maps to a field of the run file.

## 62. Featured examples: guarded vault, partial repay shield, proof-of-exploit bounty

**Choice.** The home page features one module each from Pause, Repay and Pay Out.

**Why.** They are built, they cover rule-pays and caller-pays, the public and the alternative mempool, and a condition,
a market read and a proof.

## 63. Skills and MCP pages show the design and say it is planned

**Choice.** The pages describe each skill and tool, mark them `planned`, and run nothing that does not exist. The MCP
tool inspector runs `list_modules` and `get_module` against the catalog the site ships, and says the other tools need
the server.

**Why.** The pages help settle the design now without implying anyone can install the skills or the server today.

## 64. One visual language: monochrome, glass, motion that explains

**Choice.** Black, grey and white only, dark first with a checked light theme; glass surfaces, Geist and Geist Mono,
pixel numerals for figures. Motion is used where it carries meaning: frames appearing, a check passing, a budget
filling, a value changing. Every animation respects `prefers-reduced-motion`.

**Why.** A security library should look precise rather than playful, and the animation is how the site shows the
mechanism without asking the reader to learn frame transactions first.

## 65. Organise the library by CROPS; DeFi is a filter, not a section

**Context.** The first catalog had eight corners built around DeFi actions (pause, repay, exit, liquidate, and so on).
Much of it is not needed to make the library useful, and the work with the most value to the ecosystem is censorship
resistance, open source, privacy and security.

**Choice.** Modules are grouped by the four CROPS properties, each landing ordered from the basic building block to the
modules built on it. Post-quantum is a property shown on any module, not a group. The existing DeFi modules stay and are
placed under the property they serve; "Used in: DeFi" is a filter on any module, not a section of its own.

**Why.** The library should read as one progression from a basic block to the things built from it, not as a pile of
unrelated templates, and its headline should be what makes it different.

## 66. Checks and actions explain a transaction; they are not a builder

**Context.** The rule-set engine has conditions and actions, and the new privacy and post-quantum work adds higher-level
ones such as pool membership or a one-time code.

**Choice.** They exist so the site and the Explorer can show a transaction's path: which steps ran, which passed, and
where it stopped and why. In the interface they are called checks and actions, appear as a short plain-language trail on
each module page and on a transaction in the Explorer (what the rule decided, what the network decided, what happened),
and are listed in a searchable reference under the docs. They never appear in the navigation, and there is no visual
editor for assembling them.

**Why.** The value is explaining a transaction to the person who sent it. A graph editor would be a different product.

## 67. A module says where it runs, not where it does not

**Choice.** Each module lists the configurations it runs on, such as the public mempool or the alternative mempool, as
positive chips. A refusal is shown only for a transaction that was actually refused, in the Explorer or the simulator,
with the rule that blocked it.

**Why.** A page full of "does not work on X" reads as a library with holes. The facts stay available where they help:
when something is refused.

## 68. Group modules by use case, not by CROPS

**Context.** Decision 65 grouped the library by the four CROPS properties. In practice the grouping felt forced: a
module such as a private pool serves several properties at once, and a developer looks for what they want to do, not
for a letter.

**Choice.** Modules are grouped by use case: move money privately, pay for gas, protect a position or protocol, sign
and recover, prove and publish. CROPS stays as the library's purpose and as language on the landing page, but it is not
a navigation structure. This supersedes decision 65's grouping.

**Why.** Navigation should match how a developer thinks about the problem they have.

## 69. Blocks stay in the SDK; the interface shows modules and examples

**Context.** The first structure had three levels: blocks, modules and examples, with five types of block.

**Choice.** Blocks, the small checks and actions every module is made of, stay in the SDK and are never shown in the
site, the Explorer or the docs navigation. The interface has two things: modules, and examples. A rule is shown as a
sentence with a plain-language trail of steps.

**Why.** Block names are internal detail. A developer choosing what to build does not need them, and showing them made the
product look more complicated than it is.

## 70. Examples are whole projects built from several modules

**Context.** In an early version of the site, examples and modules had the same names and the same content, which made
the distinction meaningless.

**Options.** (a) Keep modules big and examples small, as before. (b) Make modules the small parts and examples whole
projects assembled from several of them.

**Choice.** (b). A module does one job for one use case. An example is a complete project, such as a private payroll or a
safe lending market, that names the modules it uses, gives each one a role, and tells the story of how they work
together. An example's status is derived from its modules.

**Why.** The relationship should be visible: parts on one side, assembled products on the other.

## 71. A flagship account ties the modules together

**Choice.** The flagship is a single wallet account that: receives to ML-KEM stealth addresses; holds its balance in a
private pool; spends with gas paid by the pool or an open sponsor; signs with ECDSA plus Falcon; keeps a quantum switch
armed; recovers through hidden guardians; can force an exit to a pre-committed address if anyone upgrades it against the
owner; and makes every rule public and simulated before signing. Its working name is Sovereign Account.

**Why.** It is the one example that exercises almost every module, so it shows the library as a whole, and it is built
last, from modules that each ship and are tested on their own.

## 72. Keep the existing modules, sorted into the five use-case groups

**Context.** Decision 68 grouped modules by use case. The catalog still had 37 entries in eight DeFi corners, some of
them tooling or small building pieces rather than something a developer would choose.

**Choice.** Every existing module stays and moves into one of the five groups: move money privately, pay for gas,
protect a position or protocol, sign and recover, prove and publish. Only entries that are not modules leave the list:
the tooling (Core, SDK, simulator, local devnet, rule sets, CLI, watch bot, storage maps) moves to the SDK and docs
pages, and the threshold condition stays in the SDK as a block (decision 69). The five post-quantum signers (Falcon,
WOTS+, FORS, XMSS-style, SPHINCS+-style) become one post-quantum signer module with the scheme as an option, the ECDSA
signer folds into signed intent, and the reward pool folds into the proof-of-exploit bounty. Their code and tests are
unchanged.

CROPS stays the reason the library exists and shows as module properties and a line on the landing page, never as
navigation or as the headline.

**Why.** A developer arrives with a problem, not a property. Five near-identical signer pages, tooling in the module list
and a vague reward pool made the library look like a pile instead of a set of answers.
