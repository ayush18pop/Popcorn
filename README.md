# Popcorn

**OpenZeppelin for frame transactions.** Reviewed building blocks, an SDK, an MCP server and agent skills for
[EIP-8141](https://eips.ethereum.org/EIPS/eip-8141) frame transactions and the
[ERC-8421](https://ethereum-magicians.org/t/erc-8421-frame-transaction-alternative-mempools/29800) alternative mempool.

**Site:** https://popcorn-chi-five.vercel.app · **MCP:** https://popcorn-mcp.vercel.app/mcp · **SDK:** [`@popcorn-eth/sdk` on npm](https://www.npmjs.com/package/@popcorn-eth/sdk)

Frame transactions let a contract decide which transactions are valid, and pay for them. Anyone can send one, even
from a wallet with no ETH, and if the contract's condition is false the transaction is invalid and costs nothing.
Popcorn turns that into products you can ship:

| Build | What it does | Example |
|---|---|---|
| **Private** | Pay salaries to stealth addresses (ML-KEM-768 announcements); withdraw from a privacy pool to a fresh address with no ETH and no relayer; prove you belong to a group without saying who | [Private Payroll](examples/private/private-payroll) |
| **Post-quantum** | Sign with WOTS+, XMSS, FORS, SPHINCS+ or Falcon-512; flip an account to post-quantum-only the day ECDSA breaks, with a backup key nobody has seen | [Quantum-Ready Treasury](examples/sign/quantum-ready-treasury) |
| **Censorship-resistant** | A paymaster whose policy is public code, not a server that can cut you off; an exit to an address fixed on day one | [Open Gas Network](examples/gas/open-gas-network), [Walkaway Exit](examples/protect/walkaway-exit) |
| **Self-defending** | A vault that pauses itself when its numbers break, and pays a whitehat for a zero-knowledge proof of its bug | [Proof-of-Exploit Bounty](examples/protect/proof-of-exploit) |
| **All of it** | One account: stealth receive, private balance, hybrid ECDSA + Falcon owner, anonymous guardians, a post-quantum switch, a forced exit | [Sovereign Account](examples/sign/sovereign-account) |

Every example is assembled only from Popcorn blocks and recorded on a devnet: real transactions, each one explained.

## Start in one minute

**With your AI agent** (Claude Code, Codex, Gemini CLI, OpenCode or any agent that reads skills and speaks MCP):

```sh
npx degit ayush18pop/Popcorn/.claude/skills skills
```

```json
{ "mcpServers": { "popcorn": { "url": "https://popcorn-mcp.vercel.app/mcp" } } }
```

Then describe the problem: *"Pause our vault the moment assets per share fall below 1.0, with no Solidity."*

**With the SDK** (published on npm as [`@popcorn-eth/sdk`](https://www.npmjs.com/package/@popcorn-eth/sdk)):

```sh
npm i @popcorn-eth/sdk viem
```

Or run the demos from the repo:

```sh
git clone https://github.com/ayush18pop/Popcorn && cd Popcorn
bun install
bash contracts/core/build.sh && (cd contracts && forge build)
POPCORN_DEVNET=devnet1 bun packages/sdk/scripts/demo-simple-exploit.ts   # a buggy vault, attacked and stopped, on the public devnet
```

## Blocks

Every build is the same sentence: **a gas payer, conditions combined with logic operators, and actions.** Each block
does one job, keeps its state in its own storage, and is tested on its own.

| Kind | Blocks |
|---|---|
| **Conditions** (YES, NO or UNKNOWN; UNKNOWN never fires) | Compare · Percent Change · Code Hash Changed · Signature · K-of-N Attestation · Exploit Proof (ZK) · Membership Proof (ZK) |
| **Logic operators** | AND · OR · NOT / NOR · K-of-N · EXACTLY ONE · IF / ELSE |
| **Actions** | Call · Pause · Reward Pool · Anonymous Vote · Key Rotation · Withdraw All · Post-Quantum Mode · Repay |
| **Gas payers** | Self-Paying · Caller Pays (the payer earns a reward) · Paymaster |
| **Signers** | WOTS+ · XMSS · FORS · SPHINCS+ · Falcon-512 · ECDSA · Passkey (P-256 / WebAuthn) · Multisig · Hybrid |
| **Complete contracts** | Privacy Pool · Stealth Addresses |

Put them together in Solidity by inheriting them, or with no Solidity at all:

```ts
import { blocks, deployRuleSet } from "@popcorn/sdk";
const { build, allOf, noneOf, ratioCrossesLine, valueCrossesLine, getter, pauseTarget } = blocks;

const spec = build({
  when: allOf(
    ratioCrossesLine(getter(vault, "totalAssets()"), getter(vault, "totalSupply()"), "below", 1n, 1n),
    noneOf(valueCrossesLine(getter(vault, "paused()"), "above", 0n)),
  ),
  then: pauseTarget(vault),
});
const { ruleContract } = await deployRuleSet(client.popcorn, spec, { fund, stake: true });
// anyone, from a wallet with no ETH, can now pause the vault the moment its share price breaks
```

## Every transaction explains itself

Paste any frame transaction hash, included or refused, into the
[explorer](https://popcorn-chi-five.vercel.app/#/explorer): each stage (mempool admission, Core, payer, the build's
condition, inclusion) and the build's flow, block by block. Green said YES, red said NO, grey was never reached. The same
view is `inspectTransaction(hash)` in the SDK and `inspect_transaction` in the MCP server.

## What is in the box

| Path | Contents |
|---|---|
| [`contracts/`](contracts) | Core (Yul), the rule contract base and factory, the blocks (`src/blocks`), the builds (`src/builds`), signers, the rule-set engine, payers, privacy contracts |
| [`packages/sdk`](packages/sdk) | [`@popcorn-eth/sdk`](https://www.npmjs.com/package/@popcorn-eth/sdk) (on npm): a viem extension: deploy, check, trigger, simulate, watch, inspect, the `blocks` functions and every signer |
| [`packages/simulator`](packages/simulator) | Which mempool accepts a transaction, which rule blocks it, and the fix, in plain English |
| [`packages/zk`](packages/zk) | Membership, withdraw, stealth and exploit circuits (Groth16) with their proving helpers |
| [`packages/mcp`](packages/mcp) | The read-only MCP server, over stdio or hosted HTTP |
| [`.claude/skills`](.claude/skills) | Agent skills: `popcorn-build` (a problem to a running project) and `popcorn-debug` (why a transaction was refused) |
| [`devnet/`](devnet) | A one-command local devnet with an alternative-mempool sidecar |
| [`apps/web`](apps/web) | The developer site: blocks, examples, explorer, docs |
| [`docs/catalog`](docs/catalog) · [`examples/`](examples) | One page per block; six example projects with their recorded runs |
| [`journal/`](journal) | Every design decision, and the build log from the first commit |

## Tested

| Suite | Result |
|---|---|
| Contracts (`forge test`) | 286 passing, every block tested alone, invariant fuzzing, real Groth16 proofs |
| SDK (`vitest`) | 332 passing offline, plus devnet suites |
| Simulator | 152 passing |
| MCP server | 4 passing |
| Public devnet | the no-Solidity build, caller-pays and the live exploit demo run end to end |

```sh
(cd contracts && forge test)
bun run --cwd packages/sdk test
bun run --cwd packages/simulator test
```

## Networks

| | Public devnet | Local devnet |
|---|---|---|
| Chain id | 1337 | 1338 |
| Node | `https://altmempool.forshtat.com` | `http://127.0.0.1:18545` (`devnet/up.sh`) |
| Alternative mempool | `https://altmempool.forshtat.com/rpc` | `http://127.0.0.1:14338/rpc` |
| `RuleFactory` | `0x1EdD695a30f001B270e7A0F3A2781628A69E8380` | same address |

## Learn more

- [SDK reference](packages/sdk/README.md) · [Core specification](contracts/core/SPEC.md) · [Core layout and errors](contracts/core/LAYOUT.md)
- [Design decisions](journal/DECISIONS.md) · [Build log](journal/LOG.md) · [Contributor handoff](docs/HANDOFF.md)

MIT licensed.
