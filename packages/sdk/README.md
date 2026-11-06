# @popcorn/sdk

A [viem](https://viem.sh) extension for Popcorn rule contracts on EIP-8141 frame-transaction networks. You describe a
rule; the SDK builds the frame transaction, picks the nonce key, sizes the gas, tells you which mempool will accept it,
and follows it until it is included.

You never write frames by hand: `deployRule` creates a rule contract, `canTrigger` says whether its condition is true
right now, `trigger` sends the transaction that runs it (from an account with no ETH when the rule contract pays), and
`simulate` explains in plain English why a mempool would refuse it.

```sh
bun install
bash contracts/core/build.sh && (cd contracts && forge build)
devnet/up.sh                                            # the local devnet, once (see ../../devnet/README.md)
POPCORN_DEVNET=local bun packages/sdk/examples/01-rule-pays.ts
```

## The core loop

Deploy a rule contract (a funded rule contract pays for its own triggers), then trigger it from a client that has no
account:

```ts
const deployer = createWalletClient({ account: deployerAccount(), chain, transport: http() }).extend(popcorn({ devnet }));
const { ruleContract, txHash } = await deployer.deployRule({ logic: { bytecode: counter.bytecode }, fund: parseEther("0.01") });
```

```ts
const triggerer = createPublicClient({ chain, transport: http() }).extend(popcorn({ devnet }));
const before = await triggerer.canTrigger(ruleContract);
console.log("before arm():", before.name); // CONDITION_FALSE (Core 0x22)
```

```ts
const hash = await triggerer.trigger(ruleContract);
const status = await triggerer.watch(hash);
```

A false condition makes the transaction invalid, so a failed attempt is never included and costs nothing.

## Actions

| Action | What it does |
|---|---|
| `deployRule({ logic, fund, mode, stake, caps })` | Deploys the logic if needed, creates the rule contract through `RuleFactory` with safe default caps, funds it and optionally stakes it (throws `StakeNotCounted` if the registry does not count the stake) |
| `canTrigger(rule, opts?)` | Simulates the exact transaction and returns `READY` or the Core code that blocks it (`CONDITION_FALSE`, `VERIFY_GAS_BELOW_FLOOR`, …) |
| `trigger(rule, opts?)` | Builds, signs (if a payer is needed) and sends the transaction; returns its hash. Refuses when `canTrigger` is not `READY` |
| `triggerDetailed(rule, opts?)` | `trigger` plus the route it took and the prepared transaction |
| `simulate(rule, opts?)` | Both mempools' verdict, the rule that blocks and the fix. Sends nothing unless `{ sidecar: true }` |
| `watch(hash, opts?)` | Follows a transaction through the mempools to inclusion |
| `triggerAndWait(rule, opts?, { resends })` | `trigger` then `watch`; a dropped trigger that still simulates as valid is sent again, at most twice by default |
| `stakeRule(rule, opts?)` | Stakes a rule contract in the devnet's staking registry (needed to read other contracts on an alternative mempool) |
| `ownerAction(rule, call, signer, opts?)` | Runs an owner-only call, approved by an ECDSA and a WOTS+ (post-quantum) signature |
| `readOwnerState`, `readRuleContract` | Read the owner slots and the decoded arguments of a rule contract |

Caller-pays rule contracts (`mode: "callerPays"`) take a `{ payer }`: the payer's account approves and pays, and the
reward goes to whoever actually paid. See `examples/02-caller-pays.ts`. A payer contract may also take `{ payerData }` (its
frame's data) and `{ tail }` (the frame after the action); a refusal in the payer's frame is reported as `PAYER_REFUSED`
with the payer's own code.

The nonce key a trigger consumes is read from the rule contract's own `popcornNonceKey(bytes)` view, which runs the logic
in the rule contract's context, so keys derived from its address or storage are exact (decision 75).

## Blocks without Solidity

Checks, joins and stateless actions are named after their blocks and put together as data, deployed on the shared
rule-set engine (no compiler). Blocks that keep state (Reward Pool, Anonymous Vote, Key Rotation, Exit
To An Address, Post-Quantum Mode, Repay) are Solidity only: inherit them from `contracts/src/blocks`.

```ts
import { blocks, deployRuleSet } from "@popcorn/sdk";
const { build, allOf, noneOf, valueCrossesLine, getter, pauseTarget } = blocks;

const spec = build({
  name: "pause when the gauge goes over 100",
  when: allOf(valueCrossesLine(getter(gauge, "value()"), "above", 100n), noneOf(valueCrossesLine(getter(pool, "paused()"), "above", 0n))),
  then: pauseTarget(pool),
});
const { ruleContract } = await deployRuleSet(client.popcorn, spec, { fund: parseEther("0.3"), stake: true });
```

| Shape | Functions |
|---|---|
| Checks | `valueCrossesLine`, `valueOutsideBand`, `ratioCrossesLine`, `valueCrossedLineSinceLastTime`, `valueMovesTooFast`, `contractCodeChanged`, `signedInstruction`, `reportersSigned` |
| Joins | `allOf`, `anyOf`, `noneOf`, `atLeast`, `exactlyOne`, `exactly`, and `buildIfElse` for IF / ELSE |
| Actions | `makeACall`, `pauseTarget` (another contract's `pause()`), `nothing` |
| Sources | `getter`, `storage` (the build's own slot: public mempool), `ethBalance`, `erc20Balance` |

`test/blocks.network.test.ts` runs the build above on the local devnet from a key with no ETH.

## Builds

| Build | Calls |
|---|---|
| Proof-of-Exploit Bounty | `bountyClaim(recipient, claimId, proof)`, `bountyWatch(reporter)` (proofs: `@popcorn/zk` `proveExploit`) |
| Paymaster | `deployOpenSponsor`, `stakeOpenSponsor`, `configureOpenSponsor`, `sponsored(sponsor, membership?)` |
| Private Pool | `deployPrivatePool`, `poolDeposit`, `setAssociationRoot`, `poolCommitments`, `poolWithdrawal` (proofs: `@popcorn/zk` `withdrawProof`) |
| Stealth Vault | `stealthKeys`, `stealthMetaAddress`, `prepareStealthPayment` (ML-KEM-768), `stealthPay`, `stealthAnnouncements`, `scanStealth`, `stealthSpend` |
| Sovereign Account | `deploySovereignAccount`, `initializeAccount`, `spendTrigger`, `voteTrigger`, `quantumTrigger`, `migrateTrigger`, `exitTrigger`, `contestRecovery`, `finalizeRecovery` |
| Recorder | `recordTrigger`, `recordRefusal`, `storyEntry`, `writeRun` (used by `scripts/record-examples.ts`) |

## Signers

Every signature scheme the contracts verify has an off-chain signer here: ECDSA, P256 and WebAuthn passkeys, WOTS+, FORS,
XMSS-style, SPHINCS+-style and Falcon (the last four are post-quantum), plus hybrids, mixed-scheme M-of-N multisig and
k-of-n attested facts. They all sign one EIP-712 digest bound to the chain, the rule contract, the rule, its epoch and the
trigger data. One-time and few-time signers record every digest before returning a signature and refuse to sign twice.
See `examples/08-signed-intent.ts`, `09-pq-intent.ts` and `10-passkey-and-multisig.ts`.

## Rule sets

`ruleset` builds conditions out of AND / OR / NOT / k-of-n over compare, range, crossing, delta, ratio, balance,
code-hash and flag leaves, with an action per rule. `planRuleSet` estimates the gas of each rule and which mempool each
leaf needs; `deployRuleSet` deploys the result. See `examples/07-rule-set.ts`.

## Networks

| Name | Chain | Notes |
|---|---|---|
| `local` | 1338 | `devnet/up.sh`. A reproducible copy with 250,000 unstaked / 2,500,000 staked validation per entity |
| `devnet1` | 1337 | The public devnet. Its alternative-mempool sidecar accepts any validation budget; the node's own mempool allows 100,000 |

`popcorn({ devnet: "local" })`, or pass `{ factory, core }` for a network without an entry in `deployments.ts`.

## CLI

```sh
bun packages/sdk/bin/popcorn-simulate.ts <rule contract> --devnet local
```

prints the same report as `simulate`. It never sends a transaction unless you pass `--sidecar-admit`.

## Tests

```sh
bun run --cwd packages/sdk test            # offline
POPCORN_NETWORK=1 POPCORN_DEVNET=local bun run --cwd packages/sdk test:network
```

The offline tests check the encoder and trigger builder against an independent reference built from
`contracts/core/LAYOUT.md`, and every signer against vectors the Solidity tests verify.

## Limits

- A rule contract that reads another contract's storage runs on an alternative mempool with a staked rule contract.
- Validation has no clock, so there are no deadline or inactivity conditions.
- Groth16 proofs are zero-knowledge but not post-quantum; the hash-based signers are.
- Reviewed by us, not externally audited.
