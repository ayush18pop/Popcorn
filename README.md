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
| [`devnet/`](devnet) | A local devnet with per-entity validation budgets, started by one command |
| [`apps/web`](apps/web) | The developer site: module catalog, example player, explorer, docs |
| [`docs/catalog/`](docs/catalog) | One file per module: what it does, when it fires, mempool, gas, code, limits |
| [`examples/`](examples) | Runs the site's player replays, one `run.json` per example |
| [`journal/`](journal) | The decisions behind the design |

## Built so far

| Area | What | Mempool |
|---|---|---|
| Core | hardened VERIFY: frame-layout check, fee caps, once per event, re-entry lock, rule-pays and caller-pays, hybrid ECDSA + WOTS+ owner | public |
| Conditions | threshold on another contract's value, proof of a statement (Groth16), rule sets (AND / OR / NOT / k-of-n over compare, range, crossing, delta, ratio, balance, code hash, flag, with an action per rule) | public for the rule contract's own storage; alternative mempool (staked) for reads of other contracts |
| Signers | ECDSA, P256 / WebAuthn passkeys, WOTS+, FORS, XMSS-style, SPHINCS+-style, Falcon-512, hybrids, M-of-N multisig, k-of-n attested facts | WOTS+ and ECDSA fit the public 100,000 gas; the larger post-quantum schemes need the local devnet or a larger budget |
| Templates | a vault that pauses itself when its invariant breaks and pays a whitehat for a zero-knowledge proof of its bug; a loan shield that repays when health falls | |
| Tooling | simulator, SDK, local devnet, developer site | |

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
| Validation limit | 100,000 gas flat, staked or not | 250,000 unstaked / 2,500,000 staked per entity |

The public devnet's `RuleFactory` is at `0x1EdD695a30f001B270e7A0F3A2781628A69E8380`, the same address as on the local
devnet. Modules whose validation fits 100,000 gas run on both; the rest run on the local devnet. See
[`devnet/README.md`](devnet/README.md) for exactly what differs and why.

## Limits

- A drain inside a single block or transaction cannot be stopped by a rule contract; multi-transaction drains can.
- Someone still has to notice the condition and trigger the rule contract. Popcorn removes the need to hire, fund or
  trust them: any wallet can, and the reward pays them.
- Validation has no clock, so there are no deadline or inactivity conditions.
- A condition that reads another contract's storage needs stake on the alternative mempool; the public EIP-8141 mempool
  refuses it.
- Groth16 proofs are zero-knowledge but not post-quantum. The hash-based signers and keyless triggers are.
- Reviewed by us, not externally audited.

## License

MIT
