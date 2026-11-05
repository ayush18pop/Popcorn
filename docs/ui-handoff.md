# Developer site: handoff

A brief for whoever builds the Popcorn site (`apps/web`). It is a developer tool, not a consumer app and not a workflow
editor: a place to understand each module, watch it work step by step, and copy it.

## Who it is for

1. **DeFi protocol teams** deciding whether to use Popcorn for pausing, protection and exits.
2. **Wallet teams** looking at the signer and validator modules.
3. **Any developer** who wants the SDK and the contracts.

They know Solidity and viem. They do not know frame transactions, and they should not have to: every page starts from
what the module does for their protocol, then shows the mechanism.

## Principles

- **Example first.** Every module has a worked example that plays from start to finish. Nobody reads a spec before seeing
  it work.
- **Every animation is a real run.** The player replays recorded data (the simulation trace, the mempool's admission
  report, the receipt), never invented numbers. Each number on screen links to the transaction it came from.
- **Honest labels.** Gas numbers are tagged `measured` (with the network) or `estimated`. A module is `built`
  (in the repo with passing tests), `planned`, or `research`. Say "reviewed by us, not audited". Groth16 is
  zero-knowledge, not post-quantum; never imply otherwise.
- **State the limits.** Each module page has a Limits section (see the README's list).
- **Plain names.** Rule contract, condition, signer, trigger, reward, rule-pays / caller-pays. Frames, nonce keys and
  Core error codes appear only inside the player and the reference, with a one-line explanation on hover.

## Site map

| Route | Purpose |
|---|---|
| `/` | The pitch, the four mistakes Popcorn prevents, three featured examples, a quickstart |
| `/modules` | The catalog: 8 corners, filterable by trigger type and status |
| `/modules/<corner>/<module>` | One page per module (template below) |
| `/examples/<module>` | The example player for that module (also embedded in the module page) |
| `/explorer` | Rule contracts and triggers on a chosen devnet: admission reports, live rule status |
| `/skills` | The Claude skills: what each does, its methods, which pages and references it uses |
| `/mcp` | The MCP server: tools, setup, the safety model |
| `/docs` | SDK reference, contract reference, devnets, glossary |

### The 8 corners

| Corner | What it does | Trigger types |
|---|---|---|
| Pause | stop the protocol or part of it | invariant, market, dependency, people, proof |
| Repay and Top-Up | rescue a position before liquidation | invariant |
| Exit | get funds out before losses | market, invariant |
| Pay Out | bounties and rewards | proof, people |
| Liquidate Fairly | one winner, losers pay nothing | keyed-nonce tickets |
| Pay Gas | sponsor gas safely | payment, invariant, market |
| Approve and Sign | who may authorise (signers and wallet validators) | people |
| Build and Check | simulator, CLI, bot, storage maps | tooling |

Trigger types: **invariant** (the protocol's own math broke), **market** (prices, pegs, liquidity), **dependency**
(something it relies on changed), **people** (signatures), **proof** (cryptographic evidence).

Module status today: Core, conditions (threshold, proof, rule sets), every signer, the guarded vault, the loan shield, the
simulator, the SDK and the local devnet are `built`. Everything else in the catalog is `planned`. The catalog data
(`docs/catalog/*.md`, one file per module, front matter below) is the single source; the site reads it, it does not
duplicate it.

## Module page template

1. **What it does**: one sentence, in the protocol team's terms.
2. **When it fires** and **what it does then**.
3. **The example**: the embedded player.
4. **Mempool**: which mempools admit it (public EIP-8141, alternative ERC-8421 unstaked or staked), with the reason.
5. **Gas**: validation gas per rule, tagged measured or estimated, for the public (100,000) and local (250,000 / 2,500,000)
   budgets.
6. **Code**: the rule file and the Solidity or TypeScript to copy.
7. **Limits**: what it cannot do.
8. **Related modules**.

Catalog front matter (`docs/catalog/<corner>/<module>.md`):

```yaml
name: Outflow Spike Pause
corner: pause
trigger: invariant
status: built | planned | research
mempool: { public: true, alt: unstaked | staked | none }
gas: { validation: 41891, tag: measured, network: local }
example: examples/pause/outflow-spike/run.json
related: [share-price-floor-pause]
```

## The example player

The centrepiece. It replays one recorded run in five stages, as two synchronised views: the **transaction** (a column of
frames) and the **world** (the contracts and balances the run touches).

| Stage | Transaction view | World view |
|---|---|---|
| 1 Build | the frames appear one at a time: VERIFY on the rule contract, SENDER with the trigger data (caller-pays adds the payer's VERIFY frame) | the caller's wallet (0 ETH) and the rule contract |
| 2 Validate | VERIFY lights up; each condition read is a step: "read pool health = 1.08", "compare < 1.10", then APPROVE | the contracts read, with the values read |
| 3 Admit | the mempool's checks, rule by rule, pass or fail, with the stake and budget the entity has | the sidecar, the stake registry, and the entity's budget bar |
| 4 Include | the transaction moves into a block; the payer is charged | block number, gas used, payer balance |
| 5 Act | the SENDER frame runs: balances and flags change | before and after for each touched value |

Controls: play, pause, step forward and back, speed, scrub, and a **Try the failing case** toggle that replays the paired
run where the condition was false ("invalid, never included, costs nothing"). A side panel shows the raw JSON for the
current step and links to the transaction on the explorer. Respect `prefers-reduced-motion`: steps still advance, without
motion. Every stage is keyboard operable.

## Recorded runs

One file per example, `examples/<corner>/<module>/run.json`, written by a recorder script
(`packages/sdk/scripts/record-run.ts`, to be built) that executes the example on a devnet and captures:

```jsonc
{
  "module": "outflow-spike-pause",
  "network": { "name": "local", "chainId": 1338 },
  "title": "A vault pauses itself mid-drain",
  "steps": [
    { "stage": "build", "frames": [ { "mode": "VERIFY", "flags": 3, "target": "rule contract", "gasLimit": 60000, "data": "0x" },
                                      { "mode": "SENDER", "flags": 0, "target": "rule contract", "gasLimit": 90000, "data": "0x…" } ] },
    { "stage": "validate", "reads": [ { "label": "assets", "value": "880e18", "gas": 2100 } ], "result": "READY", "gasUsed": 41891 },
    { "stage": "admit", "report": { "outcome": "accepted", "checks": [ { "rule": "BUDGET-010", "verdict": "pass", "detail": "…" } ] } },
    { "stage": "include", "tx": "0x…", "block": 123, "status": "success", "payer": "rule contract", "gasUsed": 177066 },
    { "stage": "act", "before": { "paused": false }, "after": { "paused": true } }
  ],
  "failing": { "result": "CONDITION_FALSE", "steps": [ /* same shape, shorter */ ] },
  "sources": { "simulation": "ethrex_simulateFrameTransaction", "admission": "skandha_explorer_listAdmissions", "receipt": "eth_getFrameTransactionReceipt" }
}
```

The recorder gets its data from: `ethrex_simulateFrameTransaction(rawTx, "latest", { trace: true })` (execution status,
ERC-7562 trace, public-mempool verdict), the sidecar's `skandha_explorer_listAdmissions` (per-rule admission checks:
`rule`, `verdict`, `frameIndex`, `entity`, `detail`), `eth_getFrameTransactionReceipt`, and the SDK's own `canTrigger` and
`simulate` reports. A CI check should fail when a `run.json` no longer matches the contract it demonstrates.

## Explorer

Reads a chosen devnet (public or local) directly from the browser:

- **Rule contracts**: address, mode, caps, owner, stake, balance, reward pool; found by code shape (Core runtime followed by
  101 argument bytes), as the SDK does.
- **Live status**: per rule, each condition node's current result and the reason when false (the rule-set debug view), and
  whether a trigger would be accepted now (`canTrigger`).
- **Triggers**: recent triggers from the sidecar's admissions (`skandha_explorer_listAdmissions`,
  `skandha_explorer_listTransactions`), with the per-rule checks, outcome and receipt.
- **Reputation**: `skandha_explorer_listReputation` for the entities involved.

Needs CORS on the sidecar; the local devnet's sidecar serves it. Link out to the devnet's own explorer for raw
transactions. Note that the public explorer only keeps what the sidecars hold in memory, so a missing transaction there
does not mean it did not happen: always show the receipt from the chain.

## Skills page

One card per Claude skill: `popcorn-pause`, `popcorn-protect`, `popcorn-exit`, `popcorn-payout`, `popcorn-liquidate`,
`popcorn-gas`, `popcorn-sign`, `popcorn-debug`. Each card shows what the skill does in one sentence, the methods it
exposes (name, inputs, what it returns), the catalog pages and SDK references it reads, and a sample conversation ("protect
my vault if assets drop 20%") with the rule file it produces. A diagram shows how a skill's methods map to catalog pages.
The skill files live in `skills/<name>/SKILL.md`; the page is generated from them.

## MCP page

Tools, resources and the safety model. The server is **read-only by default and never holds or asks for a private key**.
Tools: `list_modules`, `get_module`, `plan_rule` (description to rule file), `check_rule` (per-mempool verdict),
`explain_rule` (live per-node result), `rule_status`, `decode_frame_tx`, `admission_report`, and `build_trigger_tx`, which
returns an **unsigned** transaction. Signing happens in the user's CLI or wallet. Show install snippets for Claude Code and
other MCP clients, and a tool inspector that calls the tools against the local devnet.

## Docs

SDK reference generated from the TypeScript types, contract reference from the NatSpec, the two devnets (what each
enforces and where they differ), the 8421 rule glossary (rule IDs with a one-line meaning, from the simulator's rule
table), and a glossary of frame-transaction terms.

## Technical shape

- Static site, no backend. Suggested: TypeScript, React and Vite, Tailwind with a component kit such as shadcn/ui, a code
  highlighter, and a small state machine for the player. Any equivalent stack is fine.
- Reuse `@popcorn/sdk` (encoding, `canTrigger`, `simulate`) and `@popcorn/simulator` (rule table, plain-English reports) in
  the browser; do not reimplement them.
- Light and dark themes, both with contrast checked. Works at phone width with a 16px gutter and no horizontal page
  scroll; the player collapses to a single column with a step list.
- Syntax-highlighted, copyable code blocks; every code block on the site is an excerpt of a file that compiles in the repo.
- Live mode: an optional switch that runs an example against the local devnet from the browser (needs the devnet running),
  using the same code path as the recorder.

## Milestones

1. Catalog schema and the first five module files; recorder script; one `run.json` (Partial Repay Shield or the guarded
   vault) end to end.
2. The player on that one run, both cases, keyboard and reduced-motion support.
3. Module pages and the catalog index; the home page.
4. Explorer (read-only).
5. Skills and MCP pages once those packages exist; docs generation.
6. Live mode.

## Open decisions (ask the team)

- Final module names and the catalog's location in the repo.
- Hosting and domain.
- Whether the player's "world view" is a diagram or a lightweight 3D scene; start with a diagram.
- Which three examples feature on the home page.
