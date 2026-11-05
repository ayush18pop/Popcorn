# @popcorn/simulator

Explains, in plain English, whether the EIP-8141 public mempool and the ERC-8421 alternative mempool will accept a
rule contract's transaction, which rule blocks it, and how to fix it.

It works on recorded outputs: a simulation result from the reference client (`ethrex_simulateFrameTransaction`), the
rule contract's balance and stake, and the mempool budgets. It never sends anything.

```ts
import { explain, formatReport } from "@popcorn/simulator";

console.log(formatReport(explain(result, { network: "local" })));
```

```
public mempool  NO   reads another contract's storage
alt mempool     NO   that read needs a stake; this rule contract has none
fix  Stake the rule contract: deployRule({ stake: true }) or stakeRule(address), then simulate again.
```

Every rejection the simulator knows has an id, a short title, a sentence and a fix (`RULES`). Core's own revert codes
come from `contracts/core/LAYOUT.md`.

```sh
bun run test
```
