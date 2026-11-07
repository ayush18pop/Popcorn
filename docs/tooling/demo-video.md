# Demo video: script and run sheet

About 3 minutes. Audience: developers who have never touched frame transactions. Every claim on screen must be
something the repository does today.

## 0:00–0:30 · What Popcorn is

**Say:** "Popcorn is OpenZeppelin for frame transactions: reviewed building blocks, an SDK, an MCP server and Claude
skills, so you can build on EIP-8141 without learning its rules the hard way."

**Show:** the site's home page (https://popcorn-chi-five.vercel.app), then the Blocks page scrolling past Core,
Common and Specialized.

## 0:30–1:00 · The problem

**Say:**
- "EIP-8141 lets a contract approve its own transaction. Validation is code: anyone can send the transaction, even
  from a wallet with no ETH, and if the condition is false it is invalid and costs nothing."
- "ERC-4337 does this off-protocol, with a bundler and an EntryPoint contract. EIP-7702 gives an EOA code, but a key
  still has to sign. Frames make it native: a transaction is split into frames, VERIFY, where the account checks and
  approves, then SENDER, where it acts."
- "That power comes with traps: banned opcodes in validation, storage you may not read, gas budgets per mempool,
  stake, nonce keys that decide how many transactions anyone can make you pay for, and refusals that only say `0x22`."

**Show:** one frame transaction in the explorer with its two frames, then a refused one showing only "Core 0x22".

## 1:00–2:00 · How Popcorn solves it

**Say:**
- "Blocks. Conditions answer YES, NO or UNKNOWN; logic operators combine them; actions do one thing; gas payers decide
  who pays. Every build is the same sentence: a payer, conditions, actions."
- "Each block is tested alone and fails closed: a read that breaks is UNKNOWN, and UNKNOWN never fires."
- "Use them in Solidity by inheriting them, or with no Solidity through the SDK's `blocks` functions."
- "Six examples are built only from blocks and recorded on a devnet: a proof-of-exploit bounty, a private payroll,
  an open gas network, a quantum-ready treasury, a walkaway exit, a sovereign account."
- "And every transaction explains itself: paste any hash, and you see which block said yes and which said no."
- "For agents: an MCP server, hosted, and Claude skills that turn a problem into a build."

**Show:** a block page (Compare: configuration, use cases, Solidity and SDK tabs); an example page with its flow tabs;
the MCP connect line; `.claude/skills/popcorn-build`.

## 2:00–3:00 · Live: a buggy vault, protected in a minute (fast-forward allowed)

**Say:** "Here is a vault with a bug. We ask Claude, with the Popcorn skill and MCP, to pause it if it is drained."

**Do (Claude Code, in this repository, MCP connected):**

```text
claude mcp add --transport http popcorn https://popcorn-mcp.vercel.app/mcp
```

Prompt:

```text
/popcorn-build Our vault contracts/src/mocks/BuggyVault.sol has a withdraw bug. Pause it the moment assets per share
fall below 1.0, with no Solidity, on the public devnet. Then show me the attack, the pause and a refused trigger.
```

What the skill does (the same steps as `packages/sdk/scripts/demo-simple-exploit.ts`, which is the fallback if the
live run is slow): `list_blocks` picks Compare, NOT and Pause; it writes

```ts
const spec = blocks.build({
  when: blocks.allOf(
    blocks.ratioCrossesLine(blocks.getter(vault, "totalAssets()"), blocks.getter(vault, "totalSupply()"), "below", 1n, 1n),
    blocks.noneOf(blocks.valueCrossesLine(blocks.getter(vault, "paused()"), "above", 0n)),
  ),
  then: blocks.pauseTarget(vault),
});
await deployRuleSet(client.popcorn, spec, { fund, stake: true });
```

then deploys, lets the attacker exploit the bug, and sends the trigger from a fresh key with no ETH.

**Show, in order:**
1. the attacker's withdraw going through (assets drop, shares stay);
2. the trigger from a key with no ETH: included, vault paused;
3. the attacker's retry: reverted on chain;
4. a trigger after the pause pasted into the explorer: red at "vault not paused", grey after it.

**Close:** "Blocks, an SDK, an MCP server and Claude skills. `bun add` it and try it on the public devnet."

## Before recording

- `forge build --root contracts`; deployer key funded on the public devnet (`keys/deployer.json`, more than 0.1 ETH).
- Run `demo-simple-exploit.ts` once to warm the shared rule-set engine and check the network is up.
- One process per key (nonces collide otherwise).
- Refused transactions live only in the sidecar's memory: inspect them during the recording, not hours later.
