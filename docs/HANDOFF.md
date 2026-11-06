# Handoff

Context for the next person or agent: what Popcorn is, the decisions taken and why, what is built, how to run and test
it, and what to do next. The numbered decisions in [`journal/DECISIONS.md`](../journal/DECISIONS.md) are the formal
record (1 to 86); this file is the story that connects them. **Next work is UI, ease of explanation, and demos you can
show and test.** Read "Next work" and "How to run" first if that is your job.

## What Popcorn is

**OpenZeppelin for frame transactions.** Reviewed building blocks for [EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)
frame transactions and the [ERC-8421](https://ethereum-magicians.org/t/erc-8421-frame-transaction-alternative-mempools/29800)
alternative mempool. A contract (a "rule contract", or "build") approves its own transaction when its conditions return
YES, so anyone can send it, even from a wallet with no ETH, and a NO costs nothing (the transaction is invalid).

Every build is the same sentence: **a gas payer + conditions (combined with logic operators) → actions.**

## The blocks (decisions 77 to 84, and 76 and 86 for the signers)

Each block does one job, keeps its state in its own namespaced storage, and is tested alone (`contracts/test/blocks`).
The catalog (`docs/catalog/<kind>/<id>.md`) is the single source for the site, the MCP server and the skill.

| Kind | Blocks (site name → catalog id) |
|---|---|
| Conditions (return YES / NO / UNKNOWN; UNKNOWN never fires) | Compare `compare`, Percent Change `percent-change`, Code Hash Changed `code-hash-changed`, Signature `signature`, K-of-N Attestation `k-of-n-attestation`, Exploit Proof (ZK) `exploit-proof`, Membership Proof (ZK) `membership-proof` |
| Logic operators | AND `and`, OR `or`, NOT / NOR `not`, K-of-N `k-of-n`, EXACTLY ONE `exactly-one`, IF / ELSE `if-else` |
| Actions | Call `call`, Pause `pause`, Reward Pool `reward-pool`, Anonymous Vote `anonymous-vote`, Key Rotation `key-rotation`, Withdraw All `withdraw-all`, Post-Quantum Mode `post-quantum-mode`, Repay `repay` |
| Gas payers | Self-Paying `self-paying`, Caller Pays `caller-pays`, Paymaster `paymaster` |
| Signers (the Signature condition's key types, post-quantum ones named) | WOTS+ `wots`, XMSS `xmss`, FORS `fors`, SPHINCS+ `sphincs`, Falcon-512 `falcon` |
| Complete contracts (whole applications, not blocks) | Privacy Pool `privacy-pool`, Stealth Addresses `stealth-addresses` |

Tiers on the site: **Core** (nothing works without these), **Common** (the headline examples), **Specialized**.
Block pages read: Overview · Configuration (with Trigger payload, Returns / Effect) · Use cases (Ready to use / Common
configurations / Other use cases, not built) · In the examples · Usage (Solidity | SDK) · Mempool · Gotchas.

**Names in code are still the earlier ones** (only the site, catalog, MCP and skill were renamed, decision 84):

| Site name | Solidity (`contracts/src/blocks`) | SDK (`blocks.*`) |
|---|---|---|
| Compare | `ValueCrossesLine` | `valueCrossesLine`, `valueOutsideBand`, `ratioCrossesLine` |
| Percent Change | `ValueMovesTooFast` | `valueMovesTooFast` |
| Code Hash Changed | `ContractCodeChanged` | `contractCodeChanged` |
| Signature | `SignedInstruction` | `signedInstruction` |
| K-of-N Attestation | `ReporterStatement` | `reportersSigned` |
| Exploit Proof | `RulesBrokenProof` | `bountyClaim` (trigger helper) |
| Membership Proof | `GroupMembership` | `membershipProof` in `@popcorn/zk` |
| AND / OR / NOT / K-of-N / EXACTLY ONE / IF-ELSE | `Join.allOf/anyOf/noneOf/atLeast/exactlyOne/ifElse` (`Answer.sol`) | `allOf`, `anyOf`, `noneOf`, `atLeast`, `exactlyOne`, `buildIfElse` |
| Call / Pause / Reward Pool | `MakeACall` / `PauseTarget` / `PayTheReward` | `makeACall` / `pauseTarget` / — |
| Anonymous Vote / Key Rotation / Withdraw All / Post-Quantum Mode / Repay | `AnonymousGroupVote` / `KeyHandover` / `ExitToAddress` / `QuantumSafeSwitch` / `RepayLoan` | Solidity only |
| Self-Paying / Caller Pays / Paymaster | `RulePays` / `CallerPays` / `OpenSponsor.yul` (names checked by the factory: keep) | `deployRule` / `trigger({ payer })` / `deployOpenSponsor` |

Renaming the code to match (`Compare.sol`, `blocks.compare()`, `Join.and`) was offered and not yet asked for.

**Two ways to put blocks together.** (1) Solidity: inherit the blocks into one build and wire them in `nonceKey`,
`condition`, `action` (`contracts/src/builds` are the worked examples). (2) No Solidity: the SDK's `blocks` functions
build a rule-set spec deployed on the shared, reviewed rule-set engine (`deployRuleSet`); only conditions, operators and
stateless actions (Call, Pause on another contract). One build = one gas class: its most expensive condition sets the
validation floor for every trigger (a 200k proof check puts the whole build on the alternative mempool).

## Builds and examples

| Example (site) | Build (`contracts/src/builds` or `src/privacy`) | Blocks |
|---|---|---|
| Proof-of-Exploit Bounty | `ProofOfExploitBounty` on the `DemoVault` target | Exploit Proof, Compare (watch), NOT (reopen), Pause, Reward Pool, Self-Paying |
| Private Payroll | `StealthVault`, `PrivatePool` (complete contracts) | Stealth Addresses, Privacy Pool, Membership Proof, Self-Paying |
| Open Gas Network | `PaidCounter` + `OpenSponsor` | Paymaster, Membership Proof, Caller Pays |
| Quantum-Ready Treasury | `SovereignAccount` | Signature, Anonymous Vote, Post-Quantum Mode, Withdraw All, Self-Paying |
| Walkaway Exit | `SovereignAccount` | Anonymous Vote, Key Rotation, Signature, Withdraw All, Self-Paying |
| Sovereign Account (flagship) | `SovereignAccount` | all of the above plus Call, Stealth Addresses, Privacy Pool |
| (tested build, no recorded example) | `AutoRepayLoan` | Compare (health factor), Repay, Caller Pays |

Each example: `examples/<group>/<id>/project.md` (problem, blocks with roles, target, build) and `run.json` (recorded on
the local devnet by `packages/sdk/scripts/record-examples.ts`: every transaction, its flow, the featured transaction's
stages and frames, and a refused case with a real refused hash).

## Flows: every transaction explained block by block (decision 85)

This is the newest and most visible feature, and the base for the next UI work.

- **Contracts.** Every build implements `IPopcornExplain.popcornExplain(triggerData, verifyData) → (trigger, flow,
  results)` (`contracts/src/rules/Explain.sol`): an ordinary view that runs the build's blocks in the same order and with
  the same short-circuits as its condition. `flow` is compact text: nodes `kind|blockId|label|inputs` separated by `;`
  (kind t trigger, p payer, c condition, o operator, a action); `results` is one byte per node (0 NO, 1 YES, 2 UNKNOWN,
  3 NOT REACHED). Compact on purpose: returning struct arrays made the Sovereign Account too big to deploy under the 2^24
  per-transaction gas cap. `test/ExplainCheck.sol` routes every condition the build suites ask through the view and
  requires the flow's verdict to equal the condition's (the 1,000-run invariant fuzz included).
- **SDK** (`packages/sdk/src/inspect.ts`, browser-safe). `inspectTransaction(hash)` finds an included transaction on the
  node and a refused or pending one in the sidecar's record (`skandha_explorer_getTransaction` keeps frames, every
  admission check and the failing frame's code). It reads trigger and verify data back out of the frames and returns the
  stages (mempool admission, Core, payer, the build's condition, inclusion), the refusal in plain English, and the flow.
  `explainTrigger(build, triggerData, verifyData)` evaluates a build's view, else a rule set's debug view (`popcornDebug`),
  else one opaque node.
- **Honesty rules built in.** The local node keeps state for the latest block only (`state root missing` for older
  blocks). So: an **included** transaction's node colours are *derived* from what inclusion proves (an AND that held → all
  inputs YES; a NOT → its input NO; an OR → "not recorded" which input); actions come from the action frame's receipt.
  A **refused** transaction's nodes are evaluated on the **current** state, and the UI says so (the sidecar's `seenAt`
  time is shown). Nothing is guessed.
- **Site.** `apps/web/src/components/FlowGraph.tsx` draws a flow left to right, like n8n: green = YES / runs, red = NO or
  UNKNOWN, grey = not reached, dashed = not recorded on chain; each node links to its block page. The **Explorer**
  (`#/explorer/<hash>`) inspects any hash: stage pipeline, refusal sentence, flow, every admission check; the sidecar's
  recent transactions are clickable rows; each example's included and refused hashes are one click away. **Example pages**
  show every recorded frame transaction as a flow (tabs), the refused one included; the raw frames are under a toggle.
- **MCP.** `inspect_transaction` returns the same view to an agent.

## How to run and test

```sh
bun install --frozen-lockfile
bash contracts/core/build.sh && (cd contracts && forge build && forge test)   # 286 pass, 5 skipped
(cd packages/sdk && npx vitest run && bunx tsc --noEmit)                       # 322 offline pass
(cd packages/simulator && npx vitest run)                                      # 152
(cd packages/mcp && bun test test/server.test.ts)                              # 4
(cd apps/web && bun run build)                                                 # site type-checks and builds
(cd apps/web && npm run dev)                                                   # http://localhost:5173 (or the next free port)
```

The local devnet (`devnet/README.md`, `devnet/up.sh`) must be up for anything live. Facts learned the hard way:

- **Proof builds need the raised sidecar budget** (decision 73): start the sidecar with
  `SIDECAR_UNSTAKED_BUDGET=10000000 SIDECAR_STAKED_BUDGET=2500000`. The sidecar build in `devnet/data/sidecar` must carry
  the *current* `devnet/patches/per-entity-budgets.patch` (it reads those variables); an older build hard-codes 250,000.
  To rebuild: stop the sidecar (by PID, `devnet/data/sidecar/sidecar.pid`), `git checkout --` the patched files in that
  directory, remove `.patched`, run `devnet/setup-sidecar.sh`, then start it with the command in `devnet/up.sh` and the
  variables above. `up.sh` itself skips the sidecar if one is already answering.
- **ZK circuits must be compiled once** (`cd packages/zk && bash scripts/build.sh`); the proving keys are committed in
  `packages/zk/setup` (do not re-run a setup: the verifiers in `contracts/src/proofs` are pinned to those keys).
- **Re-record the examples** after any contract change: `bun packages/sdk/scripts/record-examples.ts [ids]` (about 2 minutes
  per example; all six about 12 to 15 minutes). It regenerates nothing itself: run `forge build` and
  `bun packages/sdk/scripts/gen-privacy-artifacts.ts` first when the privacy or account contracts changed (the SDK
  deploys those from its bundled artifacts).
- **Devnet suites** (slow, real transactions): `POPCORN_NETWORK=1 npx vitest run test/<name>.network.test.ts` in
  `packages/sdk`. `blocks.network` (a no-Solidity build pauses another contract, about 80 s) and `account.network` (the
  Sovereign Account end to end, about 7 minutes) pass on the current code. `ruleset.network` (about 20 cases, 20+ minutes)
  was stopped partway after the engine gained EXACTLY ONE; its on-chain coverage of the new engine is `blocks.network`.
- **Code size and gas.** A build's logic must deploy under the 2^24 per-transaction gas cap; on this devnet that is
  roughly 19 to 20 KB of runtime. Current sizes: Sovereign Account 18.7 KB, bounty 16.6 KB. Check with
  `forge build --sizes` before adding code to a build.

## The public devnet (chain 1337): measured, and now the default target

Endpoints (docs: https://docs.altmempool.wtf/guides/devnet/): node `https://altmempool.forshtat.com`, sidecar
`https://altmempool.forshtat.com/rpc`, explorer https://explorer.altmempool.wtf/. There is no faucet: the published
throwaway key in the sidecar repo (`deploy/devnet/genesis.values.env`) funds new accounts with one plain transfer;
`keys/deployer.json` holds about 1 ETH there. Blocks are 60M gas and mostly empty; the base fee is a few wei.

What we learned running our tests there:

- **Tip.** The node suggests a 1-wei tip, but its builders leave frame transactions with tips under about 1 gwei unincluded
  until the sidecar drops them ("relayed 4 times without being included"). The SDK's devnet table now sets
  `minPriorityFee: 1 gwei` for devnet1; at 1 gwei a trigger lands in about 30 seconds.
- **Route.** The gateway (`altmempoolgateway.forshtat.com`) answers health checks but drops frame transactions; the
  devnet table sets `autoVia: "sidecar"` so "auto" submits to the sidecar.
- **Reads of other contracts are fine.** A no-Solidity build whose conditions read other contracts (staked) was included.
- **Passing on the public devnet:** `POPCORN_NETWORK=1 POPCORN_DEVNET=devnet1 npx vitest run test/blocks.network.test.ts`
  (the shared rule-set engine is now deployed there) and `POPCORN_DEVNET=devnet1 POPCORN_KEY=keys/deployer.json bun
  packages/sdk/examples/02-caller-pays.ts`; `inspectTransaction` explains both hashes, and the public sidecar's own
  refusals (structure, storage access, prefix budget) are named as mempool rules.
- **Not run there yet:** the six examples (they deploy 8 to 16M-gas contracts each; the network is shared, so ask first)
  and the remaining devnet suites. Never use one key from two processes at once: nonces collide.

## The deployed site

https://popcorn-chi-five.vercel.app (Vercel project `popcorn`, team ayush18pops-projects, linked in `apps/web/.vercel`).
Vercel's own build cannot see `docs/` and `examples/` (the site reads them from the repository root), so deploy prebuilt:
`cd apps/web && vercel pull --yes --environment=production && vercel build --prod && vercel deploy --prebuilt --prod`.
`VITE_DEFAULT_DEVNET=devnet1` is set on the project, so the deployed explorer starts on the public devnet; the recorded
examples' links say `#/explorer/local/<hash>` (they were recorded locally). `apps/web/package.json` pins Node 24.

## Next work: UI, ease of explanation, demos

Status at handoff: everything above is committed on branch `modular-blocks` (pushed). The six examples were being
re-recorded on the final contracts when this was written; Proof-of-Exploit, Private Payroll and Open Gas Network are
re-recorded with flows. If `examples/sign/*/run.json` and `examples/protect/walkaway-exit/run.json` lack a `flow` field,
re-record them: `bun packages/sdk/scripts/record-examples.ts quantum-ready-treasury walkaway-exit sovereign-account`.

1. **Look at the site in a browser.** The flow pages were only build-checked (no browser was available). Check
   `#/blocks`, a block page, every `#/examples/...` page and `#/explorer/<hash>` at desktop and phone width, light and
   dark. Known risks: wide flows (Sovereign vote: 8 nodes) need the horizontal scroll; node labels clamp at 2 lines.
2. **Make the flow explain itself.** Ideas the owner liked: a one-line plain-English verdict above the graph ("Refused:
   the proof is for a different recipient"); hover cards with the node's note; animate the path node by node on load;
   in Explorer, a "paste raw trigger" mode for a transaction that was never sent (use `explainTrigger`).
3. **Demos you can run and test.** A scripted demo per example that sends the included and the refused transaction and
   opens the explorer on each hash (start from `record-examples.ts`); a short "try it" flow on the landing page; a
   checklist for presenting (devnet up, sidecar budget, circuits built, re-record).
4. **Explorer coverage.** Transactions that are not Popcorn triggers show "not a Popcorn trigger"; the public devnet
   (`devnet1`) has not been tried in the explorer (CORS and its sidecar's explorer methods are untested there).
5. **Optional, not asked yet:** rename the Solidity contracts and SDK functions to the site names (see the table above).

## Direction, in the owner's words

1. **Only build what frame transactions make possible.** The test for every idea: what can only be done because
   validation is a contract?
2. **Headline: censorship resistance, privacy, security and post-quantum.** DeFi is an extra.
3. **Scope rule.** Build only what needs no devnet change, or only gas-limit changes (the patched sidecar budget is a
   gas-limit change). Core (Yul) is not changed; `RuleFactory` pins its creation hash.
4. **Blocks are Lego** (decisions 77 to 84). Simple, direct developer names (no metaphors). Examples are whole projects
   that name each block once with one role; a target such as the Demo Vault is labelled "demo, not a block".
5. **Explain every transaction** (decision 85), for any hash, from chain data only: green / red / grey per block.
6. **Wording.** Positive "Mempool" chips only; a refusal appears only for a transaction that was refused (decision 67).
   **Zero-knowledge is not post-quantum**; never imply it.
7. **Developer path with no dead ends:** landing, blocks, examples, explorer, SDK, MCP, Claude skills.
8. **Process.** Ask before product or scope decisions. Small real commits. Every decision appended to the journal in its
   own commit. No dates and no history of earlier work in this repo.

## Why these choices

- **Fail closed.** A condition that errors, runs out of gas or returns junk is UNKNOWN, and UNKNOWN never fires, even
  under NOT. EXACTLY ONE needs exact children, so signatures and proofs (whose NO only means "the witness failed") are
  refused under NOT and EXACTLY ONE.
- **Composition by inheritance** keeps a block's state in the build's own storage, which validation may read freely
  (public mempool); reading another contract needs a staked build on the alternative mempool.
- **Pause before pay.** The trigger's key is spent before the action runs, so a pause must stick even if a payment fails.
- **Rewards go to someone a copier cannot replace** (a proof-bound recipient or the gas payer), decision 7.
- **Permit2 checks the timestamp**, which validation cannot read: verify its signature in VERIFY, pull in SENDER.
- **Spend-once** comes from EIP-8250 keyed nonces: the nullifier is the nonce key.

## Networks and measured facts

| | Public devnet (1337) | Local devnet (1338) |
|---|---|---|
| Node mempool limit | 100,000 gas | 250,000 gas |
| Sidecar | `https://altmempool.forshtat.com/rpc`, no validation limit | `http://127.0.0.1:14338/rpc`, budgets from `SIDECAR_*_BUDGET` (default 250,000 / 2,500,000) |
| Per-transaction gas cap | 2^24 | 2^24 |

- `RuleFactory` is at `0x1EdD695a30f001B270e7A0F3A2781628A69E8380` on both. Permit2, USDC, WETH9, Uniswap v4 and Railgun
  are predeployed. The local node and sidecar allow browser requests (CORS `*`).
- The local node keeps only the latest state (historical `eth_call` fails), which is why included transactions' flows are
  derived from inclusion.
- The sidecar's explorer methods (`skandha_explorer_getTransaction`, `listAdmissions`) keep admitted and refused
  transactions in memory only; a restarted sidecar forgets them (included ones remain on the node).
- Qualification needs real alternative-mempool use: an admitted transaction's link on the devnet explorer, or code that
  submits one. Never call the organisers' privileged-submit endpoint.

## What is not done

1. The Sovereign Account with its ECDSA + Falcon owner is not recorded: the Falcon signer needs the `polyntt` Python
   package (installing it needs the owner's approval); the test skips without it.
2. A CI check that each recorded run matches its contract.
3. The CLI.
4. Run `client.network.test.ts` against the public devnet; measure the gateway's limit.
5. The judge's explorer link (owed by the owner).

## Pitfalls

- Pattern-based process kills (`pkill -f`) can match your own shell. Use PIDs.
- `ls` may be aliased; use `find` or `git ls-files` in scripts.
- Prague precompiles sit at low addresses (`0x0b` to `0x11` are BLS): a test that sends ETH to `address(0xD)` fails.
- `abi.encodeCall` needs the contract that declares the function (`DemoVault.deposit`, not `ProofOfExploitBounty.deposit`).
- Gas-timing tests vary with the Foundry version and with load: the SDK suite once failed one timing test while six
  recordings ran in parallel, and passed on its own.
- Commits in this repo are authored as "Divyanshh Kalra"; `git config user.name` in this checkout is a teammate's.
- Never print private keys. `keys/` and `devnet/keys/` are git-ignored.
