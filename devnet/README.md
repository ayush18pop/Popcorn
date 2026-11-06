# Local devnet

A local copy of the EIP-8141 alternative-mempool devnet: the same ethrex and Lighthouse images, genesis generator and
fork schedule as the public devnet, plus a sidecar (the ERC-8421 mempool node) with **per-entity validation budgets**.
Use it to develop offline, to reproduce a run from scratch, and to try different validation budgets.

| | Public devnet | Local devnet |
|---|---|---|
| Chain id | 1337 | 1338 (so nothing signed for one chain is valid on the other) |
| Canonical mempool (the node's own) validation limit | 100,000 | 250,000 |
| Alternative-mempool sidecar validation limit | none | 250,000 unstaked / 2,500,000 staked, per entity |
| ethrex RPC | `https://altmempool.forshtat.com` | `http://127.0.0.1:18545` |
| Sidecar / gateway | `https://altmempool.forshtat.com/rpc` | `http://127.0.0.1:14338/rpc` |
| Explorer | `https://explorer.altmempool.wtf` | `http://127.0.0.1:14339` |

## What differs from the public devnet, and why

Only gas limits, plus one stability fix:

1. **ethrex `--mempool.max-verify-gas=250000`** (the public node: 100,000), so the node's own mempool also admits a proof
   check or a larger post-quantum signature.
2. **A sidecar patch**, `patches/per-entity-budgets.patch`, applied to the workshop sidecar at commit `2e22ff0`. That
   sidecar enforces one flat `MAX_VERIFY_GAS` of 100,000 for the whole validation prefix (the public sidecar has since
   been configured without a limit). The patch implements ERC-8421's BUDGET-010 instead: each entity (sender, payer, factory) gets its own budget, 250,000 unstaked or
   2,500,000 staked, using the values on the alternative-mempool documentation's landing page. Nothing else in the
   sidecar changes: its rules, reputation and relay path are the upstream ones.
3. **A fixed address for the validator container** in `docker-compose.yml`, so it can no longer take the address
   reserved for the second beacon node.

ethrex itself is used as-is.

## Prerequisites

Docker, [Foundry](https://getfoundry.sh) (`cast`), [Bun](https://bun.sh), `python3`, `curl`, `git`.

## Run it

```sh
bash contracts/core/build.sh && (cd contracts && forge build)   # Core and the factory, once
devnet/up.sh        # first run: about 10 minutes (sidecar build, genesis, fork at epoch 2, contract library)
devnet/down.sh      # stop; chain data is kept and up.sh resumes it
devnet/reset.sh     # stop and wipe devnet/data (a fresh chain next time; keeps devnet/keys)
```

`up.sh` is idempotent. It builds the patched sidecar (`setup-sidecar.sh`), renders a genesis, starts ethrex, two
Lighthouse beacon nodes and a validator, waits for the fork that activates frame transactions, replays the public
devnet's contract library (Uniswap v4, Permit2, USDC, WETH9, Tornado, Railgun and others, at the same addresses),
starts the sidecar with automatic bundling, builds the explorer, and deploys `RuleFactory` at a fixed address.

Environment variables: `SIDECAR_DIR` (an existing patched checkout), `POPCORN_KEYS_DIR` (extra keys whose addresses are
pre-funded), `LOCAL_LIBRARY=0|bg` (skip, or replay in the background, the contract library), `LOCAL_GENESIS_DELAY`.

## Keys and data

`devnet/keys/dev-0.json` to `dev-9.json` come from the public test mnemonic (`test test … junk`) and are pre-funded.
They are for this local chain only. `dev-8` deploys the factory and `dev-9` is the sidecar's relayer. `devnet/data/`
holds chain data, logs and the built sidecar. Both folders are git-ignored.

## Using it from the SDK

```ts
import { popcorn } from "@popcorn/sdk";
const client = createPublicClient({ chain, transport: http() }).extend(popcorn({ devnet: "local" }));
```

Tests and examples pick the devnet with `POPCORN_DEVNET=local`.

## Limits

- ethrex has no notion of stake. A staked rule contract (or one that reads another contract's storage) is admitted by the
  sidecar and reaches the chain through the sidecar's privileged submit, as it would on a node that runs an
  alternative mempool. Sending the same transaction straight to ethrex is refused by its canonical rules.
- Rule contracts whose built-in stake trigger must fit the 250,000 unstaked budget cannot have a `conditionGas` above
  about 228,000.
- The public devnet remains the reference. Anything that fits its current limits should also be tried there.
