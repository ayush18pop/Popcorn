# Handoff

Context for the next person or agent picking this project up: what Popcorn is for, the decisions taken and why, what is
built, and what comes next. The numbered decisions in [`journal/DECISIONS.md`](../journal/DECISIONS.md) are the formal
record; this file is the story that connects them.

## What Popcorn is

**OpenZeppelin for frame transactions.** Standard, reviewed modules for [EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)
frame transactions and the [ERC-8421](https://ethereum-magicians.org/t/erc-8421-frame-transaction-alternative-mempools/29800)
alternative mempool. A rule contract acts when its condition is true, not when a key signs. Anyone can trigger it, even
from a wallet with no ETH, and a trigger whose condition is false is invalid and costs nothing.

Every module is built, not roadmap-only: every trigger kind is in scope, including rule composition, zero-knowledge
proofs and post-quantum signatures.

## Direction, in the owner's words and order

1. **Only build what frame transactions make possible.** Skip anything that already works without them (sandwich-proof
   swaps are largely solved elsewhere). The test for every idea: what can only be done because validation is a contract?
2. **Headline: censorship resistance, privacy, security and post-quantum.** DeFi is an extra, filtered under "Used in:
   DeFi", not a section of its own.
3. **Scope rule.** Build what needs no devnet change, or only gas-limit changes. Any other change must be disclosed to the
   organisers first. The judge approved running on our own local devnet, with gas limits free to change.
4. **Naming.** Plain words for developers: rule contract, condition, signer, trigger, reward, rule-pays / caller-pays.
   Kept on purpose: Core's on-chain `pop(bytes)` selector and the EIP-712 field `popArgsHash` (decision 54).
5. **Modules are grouped by use case**, not by the CROPS letters (decision 68, which replaced 65). The site shows only
   **Modules** and **Examples**.
6. **Blocks stay in the SDK and are hidden** from the interface (decision 69). One explanatory view shows how a module is
   assembled from them.
7. **Examples are whole projects assembled from several modules**, each module with a named role (decision 70). The first
   version made examples and modules look identical; the owner called that out as looking very bad.
8. **One flagship**: a wallet account that passes every CROPS letter (decision 71, working name Sovereign Account):
   ML-KEM stealth receive, balance in a private pool, gas paid by the pool or an open sponsor, ECDSA plus Falcon signing,
   an armed quantum switch, hidden-guardian recovery, a forced exit to a pre-committed address if anyone upgrades it
   against the owner, and every rule public and simulated before signing.
9. **Checks and actions are not a workflow editor.** There is no visual builder and they never appear in the navbar. They
   exist to explain a transaction's path: a plain-language decision trail on module pages, and in the Explorer three lanes
   (what the rule decided, what the network decided, what happened). The UI says "checks" and "then" (decision 66).
10. **Wording.** Modules show "Runs on" chips (public mempool, alternative mempool). The UI never says where something does
    not work; a refusal appears only for a transaction that was actually refused (decision 67).
11. **Developer path with no dead ends:** landing, SDK, MCP, Claude skills.
12. **Keep the rule-set composition engine** and the earlier DeFi modules.
13. **Process.** Ask before product or scope decisions or pushing design documents. Small real commits. Every decision is
    appended to the journal in its own commit. No dates and no history of earlier work in this repo.

## Why these choices

- **Zero-knowledge is not post-quantum.** Groth16 hides data but a quantum computer breaks it. Hash-only schemes (WOTS+,
  FORS, XMSS-style, SPHINCS+-style) and Falcon are post-quantum but hide nothing from chain observers. A private
  post-quantum pool needs a ZK-STARK, which is research. Never imply otherwise in the UI.
- **Permit2 checks the timestamp**, which validation cannot read, so verify its signature in VERIFY and pull in SENDER.
- **Recent roots (EIP-8272).** Core rejects recent-root references (error `0x23`), so a pool keeps its roots in its own
  storage. Own-storage reads need no stake.
- **Spend-once** comes from EIP-8250 keyed nonces: the nullifier is the nonce key and the protocol enforces it.
- **Fail closed.** A check that errors, runs out of gas or returns junk is unknown, and unknown never fires, even under NOT.

## Networks and measured facts

| | Public devnet (1337) | Local devnet (1338) |
|---|---|---|
| Node mempool limit | 100,000 gas | 250,000 gas |
| Sidecar | `https://altmempool.forshtat.com/rpc`, no validation limit (probes to 10,000,000 gas admitted) | 250,000 unstaked / 2,500,000 staked per entity (patch to the workshop sidecar) |
| Gateway | `https://altmempoolgateway.forshtat.com/rpc`, limit not measured | n/a |

- The workshop sidecar implements an earlier ERC-7562-based draft, not ERC-8421. The draft text says 100k/1M and the
  landing page says 250k/2.5M.
- Permit2, USDC, WETH9, Uniswap v4 and Railgun are predeployed on both. `RuleFactory` is at
  `0x1EdD695a30f001B270e7A0F3A2781628A69E8380` on both. The public faucet was empty.
- Qualification needs real alternative-mempool use: a link to an admitted transaction on the devnet explorer, or code that
  submits one, and the team must be able to explain the design, the code and the trade-offs. The public explorer only
  holds what sidecars keep in memory, so always keep the receipt too.
- Never call the organisers' privileged-submit endpoint ourselves.

## What is built

- **Core** (Yul): one frame layout, fee caps, once per event, re-entry lock, VERIFY gas floor, hybrid ECDSA + WOTS+ owner.
- **Contracts**: rule contract base, factory, stake, owner, conditions, signers, payers, the rule-set engine, templates
  (guarded vault, partial repay shield). 238 tests.
- **Rule sets**: AND, OR (with caller hint), NOT, k-of-n, if / else rules, three-valued fail-closed evaluation, per-leaf gas
  caps, configuration stored as contract code, a `popcornDebug` view.
- **Signers**: ECDSA, P256 / WebAuthn, WOTS+, FORS, XMSS-style, SPHINCS+-style, Falcon, hybrids, multisig, attested facts.
- **`packages/simulator`** (152 tests) and **`packages/sdk`** (303 offline tests, examples 01 to 10, network suites for
  signed intents, post-quantum and rule sets).
- **`devnet/`**: one command local devnet with per-entity budgets.
- **`apps/web`**: the developer site from an earlier shape (eight corners, 37 catalog modules, sample runs).

## What is not done

1. Rework the site and catalog from eight corners to use-case modules and project examples (decisions 68 to 71).
2. Build the new modules, starting with the smaller examples or the flagship's parts (undecided; ask).
3. A recorder that replaces sample runs with real runs, and a CI check that each run matches its contract.
4. The CLI, the Claude skills and a read-only MCP server (never holds a key; returns unsigned transactions).
5. Run `client.network.test.ts` against the public devnet; measure the gateway's limit.
6. Inputs still owed by the owner: the judge's explorer link, final module names and groups.

## Interactive design reference

The agreed structure was prototyped as a single-page explainer: five use-case groups, 17 modules each with a
plain-language rule, an allowed / refused trail and the "runs on" chips, six project examples built from 4 to 6 modules,
the flagship, the developer path, and a "how a module is built" view with AND / OR / NOT / k-of-n, if / else and
fail-closed evaluation. Treat it as the source for names and groupings until the site is reworked.

## Pitfalls

- Pattern-based process kills (`pkill -f`) can match your own shell. Use PIDs.
- `ls` may be aliased; use `find` or `git ls-files` in scripts.
- Chain commands with `&&` so a failed test stops the commit.
- Do not edit a running shell script.
- Gas-timing tests vary with the Foundry version; compare against a control tree.
- Never print private keys. `keys/` and `devnet/keys/` are git-ignored.
