# Demo video: script and run sheet

About 3 minutes. Audience: developers who have never touched frame transactions. The thread through every part: frame
transactions make a new kind of product possible (private, post-quantum, censorship-resistant, self-defending), and
Popcorn's blocks are how you build them. Every claim on screen must be something the repository does today.

## 0:00–0:30 · What Popcorn is, and what it unlocks

**Say:**
- "Popcorn is OpenZeppelin for frame transactions: reviewed building blocks, an SDK, an MCP server and agent skills."
- "Frames let a contract decide which transactions are valid and pay for them. That unlocks products you could not build
  before:"
  - "**private** money: salaries paid to stealth addresses, withdrawals from a privacy pool to a fresh address with no
    ETH and no relayer;"
  - "**post-quantum** accounts: a treasury that, the day ECDSA breaks, only moves with a post-quantum key nobody has seen;"
  - "**censorship-resistant** gas: a paymaster whose policy is public code, not a server that can cut you off;"
  - "**self-defending** protocols: a vault that pauses itself, and pays a whitehat for a zero-knowledge proof of its bug."
- "Popcorn gives you each of these as blocks you plug together."

**Show:** the site home page (https://popcorn-chi-five.vercel.app), then a fast scroll through the six examples:
Private Payroll, Open Gas Network, Quantum-Ready Treasury, Walkaway Exit, Proof-of-Exploit Bounty, Sovereign Account.

## 0:30–1:00 · The problem

**Say:**
- "EIP-8141 lets a contract approve its own transaction. Validation is code: anyone can send the transaction, even
  from a wallet with no ETH, and if the condition is false it is invalid and costs nothing."
- "ERC-4337 does this off-protocol, with a bundler and an EntryPoint contract. EIP-7702 gives an EOA code, but a key
  still has to sign. Frames make it native: a transaction is split into frames, VERIFY, where the account checks and
  approves, then SENDER, where it acts."
- "So the new products are possible, but hard to build safely: banned opcodes in validation, storage you may not read,
  gas budgets per mempool, stake, nonce keys that decide how many transactions anyone can make you pay for, and
  refusals that only say `0x22`. A private pool, a quantum switch or a public paymaster each hits all of them."

**Show:** one frame transaction in the explorer with its two frames, then a refused one showing only "Core 0x22".

## 1:00–2:00 · How Popcorn solves it

**Say:**
- "Blocks. Conditions answer YES, NO or UNKNOWN; logic operators combine them; actions do one thing; gas payers decide
  who pays. Every build is the same sentence: a payer, conditions, actions."
- "The new horizons are blocks too:"
  - "privacy: **Membership Proof** (prove you are in a group without saying who), the **Privacy Pool** and **Stealth
    Addresses**;"
  - "post-quantum: **Signature** with WOTS+, XMSS, FORS, SPHINCS+ or Falcon keys, and **Post-Quantum Mode**;"
  - "censorship resistance: the **Paymaster** with a public policy, **Withdraw All** to an address nobody can change;"
  - "security: **Exploit Proof**, **Pause**, **Reward Pool**."
- "Zero-knowledge and post-quantum are different claims, and the pages say which is which: a ZK proof hides data, a
  post-quantum signature survives a quantum computer."
- "Each block is tested alone and fails closed: a read that breaks is UNKNOWN, and UNKNOWN never fires."
- "Use them in Solidity by inheriting them, or with no Solidity through the SDK's `blocks` functions."
- "Six examples are built only from blocks and recorded on a devnet, one for each horizon."
- "Every transaction explains itself: paste any hash, and you see which block said yes and which said no."
- "And for AI agents, any of them: a hosted MCP server and agent skills that turn a problem into a build."

**Show:** the Blocks page (the Signers row marked post-quantum, the privacy blocks); the Private Payroll and
Quantum-Ready Treasury example pages with their flows; the Skills page's three install lines.

## 2:00–3:00 · Live: a buggy vault, protected in a minute (fast-forward allowed)

**Say:** "Here is the shortest path from problem to product: a vault with a bug, and an AI agent with the Popcorn
skill and MCP server, asked to pause it if it is drained."

**Do (any agent that reads skills and speaks MCP; shown with one, in this repository):**

```text
npx degit ayush18pop/Popcorn/.claude/skills skills
{ "mcpServers": { "popcorn": { "url": "https://popcorn-mcp.vercel.app/mcp" } } }
```

Prompt:

```text
Use the popcorn-build skill. Our vault contracts/src/mocks/BuggyVault.sol has a withdraw bug. Pause it the moment
assets per share fall below 1.0, with no Solidity, on the public devnet. Then show me the attack, the pause and a
refused trigger.
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

**Close:** "That was the security horizon in one minute. The same blocks build the private, post-quantum and
censorship-resistant ones: the six examples are on the site. Get the skills with one `npx` line, point your agent at
the MCP server, and build the product frames make possible."

## Before recording

- `forge build --root contracts`; deployer key funded on the public devnet (`keys/deployer.json`, more than 0.1 ETH).
- Run `demo-simple-exploit.ts` once to warm the shared rule-set engine and check the network is up.
- One process per key (nonces collide otherwise).
- Refused transactions live only in the sidecar's memory: inspect them during the recording, not hours later.
- Do not say `npm install` / `bun add`: the SDK is not published to npm yet. Say "one `npx` line" (the skills) or
  "clone the repository".
- Never say or imply that zero-knowledge is post-quantum.
