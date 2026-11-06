---
name: popcorn-build
description: Build something with Popcorn (frame-transaction blocks for EIP-8141): turn a problem such as "pause our vault if it is drained", "pay salaries privately", "free transactions for our members", "survive a quantum break" or "let users exit if the guardians turn" into a build made of blocks, start from the closest example project, deploy it to the local devnet and run it. Use when the user wants to build, deploy or adapt a Popcorn block, build or example.
---

# Building with Popcorn

Popcorn is a set of blocks for EIP-8141 frame transactions: a contract approves its own transaction when its checks say
yes, so anyone can send it, even from a key with no ETH, and a no costs nothing. Every build is the same sentence:

    a payer + checks (joined together) -> actions

- **checks** answer yes / no / unknown (unknown never fires): Value Crosses A Line, Value Moves Too Fast, Contract Code
  Changed, Signed Instruction, Statement Signed By k Of n Reporters, Proof That The Rules Were Broken, Prove You're In
  The Group
- **joins** combine checks: All Of, Any Of, None Of, At Least k Of n, Exactly One Of, If / Else
- **actions** do one thing: Make A Call, Pause The Target, Pay The Reward, Anonymous Group Vote, Hand Over To A New Key,
  Exit To An Address, Switch To Quantum-Safe Only, Repay A Loan
- **payers**: Contract Pays The Gas, Payer Gets Rewarded, Public Gas Sponsor

Private Pool and Stealth Vault are ready-made builds (whole applications), not blocks. Work from the user's problem,
not from block names.

## 1. Find the blocks

Use the `popcorn` MCP server (read-only; `packages/mcp`). If it is not connected, read `docs/catalog/<shape>/*.md` and
`examples/*/*/project.md` directly.

- `list_examples` first: if an example project solves the same problem, start from it (Proof-of-Exploit Bounty, private
  payroll, open gas network, quantum-ready treasury, walkaway exit, and the flagship Sovereign Account).
- `list_blocks` (optionally by shape or tier), then `get_block` for each candidate. Read its inputs, "Runs on" and
  "Limits" before proposing it.
- `how_to_build` gives an example's blocks with their roles and the code for each.

Say plainly what each block does for the user and what it costs. Never claim a Groth16 block (a proof, a group vote) is
post-quantum: it is zero-knowledge, not post-quantum. Post-quantum covers signatures (WOTS+, FORS, XMSS, SPHINCS+, Falcon)
and the ML-KEM stealth announcement.

## 2. Pick a way to put the blocks together

- **No Solidity** (checks, joins, Make A Call, Pause The Target on another contract): the SDK's `blocks` functions build
  the spec and `deployRuleSet` publishes it on the shared rule-set engine. Example: `packages/sdk/test/blocks.network.test.ts`.
  ```ts
  const { build, allOf, noneOf, valueCrossesLine, getter, pauseTarget } = blocks;
  const spec = build({ when: allOf(valueCrossesLine(getter(gauge, "value()"), "above", 100n), noneOf(valueCrossesLine(getter(pool, "paused()"), "above", 0n))), then: pauseTarget(pool) });
  const { ruleContract } = await deployRuleSet(client.popcorn, spec, { fund, stake: true });
  ```
- **Solidity** (any block, including the ones that keep state: Pay The Reward, Anonymous Group Vote, Hand Over To A New
  Key, Exit To An Address, Switch To Quantum-Safe Only, Repay A Loan, Pause The Target on the build itself): inherit the
  blocks from `contracts/src/blocks` and wire them in `nonceKey` / `condition` / `action`. The builds in
  `contracts/src/builds` are the worked examples (ProofOfExploitBounty, SovereignAccount, AutoRepayLoan); each block has a
  test build in `contracts/test/blocks/BlockBuilds.sol`.

One build = one gas class: the most expensive check sets the validation floor for every trigger of that contract, so a
cheap public-mempool trigger and a 200k proof check belong in separate builds if the cheap one must stay public.

## 3. Run it on the local devnet

The devnet must be up (`devnet/README.md`). Proof blocks need the sidecar with `SIDECAR_UNSTAKED_BUDGET=10000000`
(decision 73), because Core makes every trigger declare its whole validation gas, including the stake trigger.

- To reproduce an example exactly: `bun packages/sdk/scripts/record-examples.ts <example-id>`. It deploys the build, runs
  the story, and rewrites `examples/<group>/<id>/run.json` with the real transactions.
- To adapt one: copy that example's function from `packages/sdk/scripts/record-examples.ts` into a new script and change
  the parameters. The SDK calls it uses are the public API: `deployPrivatePool`, `deployStealthVault`,
  `deployOpenSponsor`, `stakeOpenSponsor`, `sponsored`, `deploySovereignAccount`, `initializeAccount`, `bountyClaim`,
  `bountyWatch`, and the trigger builders.
- Proofs come from `@popcorn/zk` (`proveExploit`, `withdrawProof`, `stealthProof`, `membershipProof`). The circuits must be
  compiled once: `cd packages/zk && bash scripts/build.sh`.

Before sending anything, call `can_trigger` (or the SDK's `canTrigger`) and show the user the verdict. If it is refused,
use the popcorn-debug skill.

## 4. Hand back

Report the deployed addresses, each transaction hash with what it did, and which block did it. Point the user at the
example's page on the developer site (`apps/web`, `#/examples/<group>/<id>`) to replay it frame by frame.

Never print or copy private keys. Local keys live in `devnet/keys/` and are git-ignored.
