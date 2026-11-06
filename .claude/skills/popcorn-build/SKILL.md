---
name: popcorn-build
description: Build something with Popcorn (frame-transaction modules for EIP-8141): turn a problem such as "pay salaries privately", "free transactions for our members", "survive a quantum break" or "let users exit if the guardians turn" into the right modules, start from the closest example project, deploy it to the local devnet and run it. Use when the user wants to build, deploy or adapt a Popcorn module or example.
---

# Building with Popcorn

Popcorn is a library of modules for EIP-8141 frame transactions: a contract approves its own transaction when its
condition is true, so anyone can send it, even from a key with no ETH, and a false condition costs nothing. Modules
each do one job; examples are whole projects assembled from several modules, recorded on a devnet.

Work from the user's problem, not from module names.

## 1. Find the modules

Use the `popcorn` MCP server (read-only; `packages/mcp`). If it is not connected, read `docs/catalog/<group>/*.md` and
`examples/*/*/project.md` directly.

- `list_examples` first: if an example project solves the same problem, start from it. Five exist: private payroll,
  open gas network, quantum-ready treasury, walkaway exit, and the flagship Sovereign Account.
- `list_modules` with a group (private, gas, protect, sign, prove), then `get_module` for each candidate. Read
  "When it fires", "Runs on" and "Limits" before proposing it.
- `how_to_build` gives an example's modules with their roles and the SDK calls for each.

Say plainly what each module does for the user and what it costs. Never claim a Groth16 module is post-quantum: it is
zero-knowledge, not post-quantum. Post-quantum covers signatures (WOTS+, FORS, XMSS, SPHINCS+, Falcon) and the ML-KEM
stealth announcement.

## 2. Run it on the local devnet

The devnet must be up (`devnet/README.md`). Proof modules need the sidecar with
`SIDECAR_UNSTAKED_BUDGET=10000000 SIDECAR_STAKED_BUDGET=10000000` (decision 73), because Core makes every trigger declare
its whole validation gas, including the stake trigger.

- To reproduce an example exactly: `bun packages/sdk/scripts/record-examples.ts <example-id>`. It deploys every module,
  runs the story, and rewrites `examples/<group>/<id>/run.json` with the real transactions.
- To adapt one: copy that example's function from `packages/sdk/scripts/record-examples.ts` into a new script and change
  the parameters (denomination, budgets, guardians, threshold, recovery delay, exit address). The SDK calls it uses are
  the public API: `deployPrivatePool`, `deployStealthVault`, `deployOpenSponsor`, `stakeOpenSponsor`, `sponsored`,
  `deploySovereignAccount`, `initializeAccount`, and the trigger builders.
- Proofs come from `@popcorn/zk` (`withdrawProof`, `stealthProof`, `membershipProof`). The circuits must be built once:
  `cd packages/zk && bun run build`.

Before sending anything, call `can_trigger` (or the SDK's `canTrigger`) and show the user the verdict. If it is refused,
use the popcorn-debug skill.

## 3. Hand back

Report the deployed addresses, each transaction hash with what it did, and which module did it. Point the user at the
example's page on the developer site (`apps/web`, `#/examples/<group>/<id>`) to replay it frame by frame.

Never print or copy private keys. Local keys live in `devnet/keys/` and are git-ignored.
