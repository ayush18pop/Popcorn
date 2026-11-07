# Build log

How Popcorn came to be what it is, phase by phase, from the first commit. [`DECISIONS.md`](DECISIONS.md) holds the
numbered decisions (1 to 86) and why each was taken; this file is the order in which the work happened and what each
phase delivered. New phases are added at the bottom.

## 1. Core

The account code every rule contract runs, written in Yul: one frame layout, fee caps, once-per-event nonce keys, a
re-entry lock, a validation gas floor, and a hybrid ECDSA + WOTS+ owner. Its ABI, argument layout, error codes and the
EIP-8141 reference values were documented alongside (`contracts/core`). `RuleFactory` pins Core's creation hash, so a
rule contract can only run the reviewed build.

## 2. The contract library

The rule contract base, the factory, stake and owner, and the two payment modes (rule-pays, caller-pays with a reward
to whoever paid). Then the first conditions (a value threshold, a proof), the signers (ECDSA, P-256 / WebAuthn,
multisig, attested facts, and the post-quantum schemes WOTS+, FORS, XMSS-style, SPHINCS+-style and Falcon-512), the
rule-set engine for composing conditions as data, and the first templates with the exploit verifier.

## 3. Journal and CI

The decision journal started here, and CI builds Core and runs the contract, simulator and SDK tests on every push.

## 4. The simulator

`@popcorn/simulator` answers "which mempool will accept this transaction, which rule blocks it, and what is the fix",
in plain English, for every Core code and every mempool rule met so far.

## 5. The SDK and the devnets

`@popcorn/sdk`, a viem extension: deploy a rule contract, check whether it can trigger, trigger it from an account with
no ETH, simulate, watch, stake, and sign intents with every scheme the contracts verify. Runnable examples for each.
A one-command local devnet with an alternative-mempool sidecar patched for per-entity validation budgets, and
`RuleFactory` deployed at the same deterministic address on the local and the public devnet.

## 6. The developer site and the catalog

`apps/web`: a catalog with one page per module, sample runs in the recorder's format, a player that replays a
transaction stage by stage, and an explorer. Probes measured each mempool's real validation-gas limit, and network
suites ran the signers and the rule-set engine on a devnet. Decisions 56 to 67.

## 7. Privacy, gas, accounts, and the first examples

The library grew past DeFi safety: a privacy pool whose withdrawals pay their own gas, with association sets; stealth
payments announced with ML-KEM-768; an open sponsor (a paymaster whose policy is public code, with an anonymous
membership gate); hidden guardians, a quantum switch, a forced exit, and the Sovereign Account that assembles them. The
ZK circuits (membership, withdraw, stealth, exploit) with their keys. A recorder wrote six example projects from real
devnet runs. A read-only MCP server and two agent skills shipped in the repository. Decisions 68 to 75.

## 8. Blocks

The modules were reworked into blocks, each with one job and its own tests: conditions that answer YES, NO or UNKNOWN,
logic operators (AND, OR, NOT / NOR, K-of-N, EXACTLY ONE, IF / ELSE), actions and gas payers. The guarded vault became a
demo target plus the Proof-of-Exploit Bounty build; the Sovereign Account and the repay shield became compositions of
blocks. EXACTLY ONE joined the rule-set engine. The SDK's `blocks` functions put conditions and stateless actions
together with no Solidity. The catalog, the site, the MCP server and the skills moved to blocks, with names a developer
already knows, and the post-quantum signers kept their own pages. Decisions 76 to 84 and 86.

## 9. Every transaction explained

Every build gained an explain view that reports its flow node by node, tested to agree with its condition. The SDK's
inspector finds any frame transaction, included or refused, and reports each stage and each block's result; the site's
explorer and every example page draw it as a flow (green, red, grey), and the MCP server returns it to an agent.
Decision 85.

## 10. The public devnet, hosting and demos

The SDK learned the public devnet's real behaviour (its builders include frame transactions only with a tip of about
1 gwei, and its gateway drops them, so it submits to the sidecar), and the no-Solidity build and caller-pays tests pass
there. The site is deployed on Vercel, defaulting to the public devnet, and the MCP server is hosted over Streamable
HTTP. An incident view tells an attack's story transaction by transaction, rule-set nodes read in plain words, and a
live exploit demo runs end to end on the public devnet. The install path became one `npx` line for the skills and one
config line for the MCP server, for any AI agent.
