# Popcorn

**OpenZeppelin for frame transactions.** Standard, reviewed building blocks for keeping DeFi secure on
[EIP-8141](https://eips.ethereum.org/EIPS/eip-8141) frame transactions and the
[ERC-8421](https://ethereum-magicians.org/t/erc-8421-frame-transaction-alternative-mempools/29800) alternative mempool.

A frame transaction lets a contract decide which transactions are valid and pay for them. That is powerful, and it opens
new ways for a DeFi team to get things wrong. Popcorn is the safe default for each of them:

| New capability | Common mistake | Popcorn part |
|---|---|---|
| A contract approves its own transactions | strangers attach extra work, inflate fees, or replay an event | **Core**: one frame layout, fee caps, once per event, a re-entry lock |
| A contract pays gas for others | a drained paymaster | **Payers**: rule-pays and caller-pays, with a reward to whoever paid |
| Validation reads DeFi state | valid at admission, invalid at inclusion, so the mempool throttles you | **`simulate()`**: which mempool admits it, and why |
| Validation runs arbitrary logic | buggy hand-rolled checks | **Conditions and signers**: thresholds, rule sets, signatures (including post-quantum), proofs |

A **rule contract** acts when its **condition** is true, not when a key signs. Anyone can **trigger** it, even from a wallet
with no ETH; if the condition is false the transaction is invalid, so a failed attempt costs nothing.

## What is here

| Path | Contents |
|---|---|
| [`contracts/`](contracts) | Core (Yul), the rule contract base, factory, stake and owner, conditions, signers, the rule-set engine, payers, templates |
| [`packages/sdk`](packages/sdk) | `@popcorn/sdk`: a viem extension (`deployRule`, `canTrigger`, `trigger`, `simulate`, `watch`) and every signer |
| [`packages/simulator`](packages/simulator) | `@popcorn/simulator`: which mempool will accept a transaction, which rule blocks it, and the fix |
| [`packages/zk`](packages/zk) | `@popcorn/zk`: the membership, withdraw and stealth circuits (Groth16), their development keys and proving helpers |
| [`packages/mcp`](packages/mcp) | `@popcorn/mcp`: a read-only MCP server (catalog, examples, refusal codes, simulate, unsigned triggers) |
| [`.claude/skills`](.claude/skills) | Claude skills: `popcorn-build` (problem to running project) and `popcorn-debug` (why a trigger was refused) |
| [`devnet/`](devnet) | A local devnet with per-entity validation budgets, started by one command |
| [`apps/web`](apps/web) | The developer site: modules in five use-case groups, example projects, explorer, docs |
| [`docs/catalog/`](docs/catalog) | One file per module, in five use-case groups: what it does, when it fires, where it runs, code, limits |
| [`examples/`](examples) | Example projects: `project.md` (problem, modules and roles) and `run.json` recorded on the local devnet |
| [`journal/`](journal) | The decisions behind the design |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | Project context for a new contributor or agent |

## Built so far

| Area | What | Runs on |
|---|---|---|
| Core | hardened VERIFY: frame-layout check, fee caps, once per event, re-entry lock, rule-pays and caller-pays, hybrid ECDSA + WOTS+ owner | public mempool, alternative mempool |
| Conditions | threshold on another contract's value, proof of a statement (Groth16), rule sets (AND / OR / NOT / k-of-n over compare, range, crossing, delta, ratio, balance, code hash, flag, with an action per rule) | public mempool for the rule contract's own storage; alternative mempool, staked, for reads of other contracts |
| Signers | ECDSA, P256 / WebAuthn passkeys, WOTS+, FORS, XMSS-style, SPHINCS+-style, Falcon-512, hybrids, M-of-N multisig, k-of-n attested facts | alternative mempool (all schemes); public mempool for ECDSA and WOTS+ |
| Templates | a vault that pauses itself when its invariant breaks and pays a whitehat for a zero-knowledge proof of its bug; a loan shield that repays when health falls | alternative mempool |
| Privacy | a private pool whose withdrawals pay their own gas, with association sets; stealth payments announced with ML-KEM-768 | alternative mempool, staked |
| Gas | an open sponsor: a payer contract with a public policy (budgets, fee cap, allowlists, a private membership gate) | alternative mempool, staked |
| Accounts | the Sovereign Account: ECDSA + Falcon owner, hidden guardians, a quantum switch with a committed post-quantum backup key, a forced exit | alternative mempool, staked |
| Examples | five projects recorded on the local devnet: private payroll, open gas network, quantum-ready treasury, walkaway exit, Sovereign Account | |
| Tooling | simulator, SDK, ZK circuits, local devnet, recorder, read-only MCP server, Claude skills, developer site | |

Planned, in this order: an action library (pause, repay, exit, reward pool), pause modules for common invariants, position
protection and exits, fair liquidation with keyed-nonce tickets, safe gas sponsorship, ERC-8286 wallet validators, a CLI,
Claude skills and an MCP server, and an example-based developer site.

## Quickstart

Needs [Bun](https://bun.sh), [Foundry](https://getfoundry.sh), `python3` and `curl`. For the local devnet also Docker.

```sh
bun install
scripts/install-solc.sh                              # solc 0.8.33
bash contracts/core/build.sh                          # builds Core; prints its size
(cd contracts && forge build && forge test)           # 238 tests
bun run --cwd packages/sdk test                       # 303 offline tests

devnet/up.sh                                          # local devnet, about 10 minutes the first time
POPCORN_DEVNET=local bun packages/sdk/examples/01-rule-pays.ts

(cd apps/web && npm ci && npm run dev)               # the developer site on localhost:5173
```

The example deploys a rule contract, shows its condition false (`CONDITION_FALSE`), arms it, and triggers it from a client
with no account and no ETH. See [`packages/sdk/README.md`](packages/sdk/README.md) for the full API.

## Networks

| | Public devnet | Local devnet |
|---|---|---|
| Chain id | 1337 | 1338 |
| Alternative-mempool sidecar | `https://altmempool.forshtat.com/rpc`, no validation limit | `http://127.0.0.1:14338/rpc`, 250,000 unstaked / 2,500,000 staked per entity by default; `SIDECAR_UNSTAKED_BUDGET` raises it (decision 73) |
| Canonical mempool (the node's own) | 100,000 gas | 250,000 gas |

Every module runs on the public devnet through its alternative-mempool sidecar; the local devnet is a reproducible copy
for development and offline work. The `RuleFactory` is at `0x1EdD695a30f001B270e7A0F3A2781628A69E8380` on both. See
[`devnet/README.md`](devnet/README.md) for exactly what differs.

## Limits

- A drain inside a single block or transaction cannot be stopped by a rule contract; multi-transaction drains can.
- Someone still has to notice the condition and trigger the rule contract. Popcorn removes the need to hire, fund or
  trust them: any wallet can, and the reward pays them.
- Validation has no clock, so there are no deadline or inactivity conditions.
- A condition that reads another contract's storage runs on the alternative mempool with a staked rule contract.
- Groth16 proofs are zero-knowledge but not post-quantum. The hash-based signers and keyless triggers are.
- Reviewed by us, not externally audited.

## License

MIT
