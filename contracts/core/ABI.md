# Popcorn Core: reserved ABI

Shared by `PopcornCore.yul` (constants `SEL_*`), the SDK, and every logic contract. These selectors are compiled into
Core and cannot change without a new Core.

| Function | Selector | Called by Core in | How |
|---|---|---|---|
| `pop(bytes popArgs)` | `0xd9292504` | (the SENDER frame's calldata, not a function on logic) | SENDER frame data = `abi.encodeWithSelector(0xd9292504, popArgs)`: frame 1 (mode 0) / frame 2 (mode 1). The SDK's `trigger()` builds this. |
| `__nonceKey(bytes popArgs) view returns (uint256)` | `0x97031c8c` | VERIFY | `DELEGATECALL`, 10,000 gas, must return 32 bytes |
| `__condition(bytes popArgs, bytes verifyData) view returns (bool)` | `0x05f661f0` | VERIFY | `DELEGATECALL`, `conditionGas` (immutable arg), must return the word `1` |
| `__action(bytes popArgs, address payer)` | `0x6019566d` | SENDER | `DELEGATECALL`, all remaining gas, revert bubbled verbatim |

`popArgs` is the trigger data: a proof, a signature or a witness carried in the transaction.

## Ordinary calls (forward path)

Any call to a rule contract from a caller other than `0xaa` and the rule contract itself, with non-empty calldata, is
DELEGATECALLed to logic with all gas; return and revert data are bubbled verbatim and `msg.value` stays with the rule
contract. Core refuses (32-byte code): `0x3a` calldata under 4 bytes, `0x38` any of the four selectors above, `0x39`
while `__action` runs. So a logic's public functions are the rule contract's ordinary API (for example a vault's
`deposit` / `withdraw`), and the reserved hooks stay reachable only from Core. Empty calldata is a plain ETH transfer
(STOP). Details: `LAYOUT.md` "FORWARD".

## Encoding rules

- **SENDER frame data** (frame 1 in rule-pays, frame 2 in caller-pays) must be the canonical encoding:
  `selector ‖ 0x20 ‖ len ‖ popArgs ‖ zero padding to 32`. Length must equal `68 + ceil32(len)`, the padding bytes must
  be zero, and `len ≤ maxTriggerDataLength`. Anything else is invalid (Core errors `0x0e`-`0x11`, `0x26`, `0x25`), so each
  popArgs has exactly one valid SENDER data.
- **Frame 0 (VERIFY) data** = verifyData, at most `maxVerifyDataLength` bytes (`0x24`); empty is fine.
- **`__nonceKey` calldata** = `0x97031c8c ‖ frame1.data[4:]`, i.e. exactly `abi.encodeCall(__nonceKey, (popArgs))`.
- **`__condition` calldata** = `abi.encodeCall(__condition, (popArgs, verifyData))`, where `verifyData` is frame 0's
  data, read with `FRAMEDATACOPY(…, 0)`. Frame 0 data is covered by the signature hash, but rule-pays transactions carry
  no signatures, so anyone can choose verifyData: treat it as untrusted input (a proof, a hint), never as authorization.
- **`__action` calldata** = `abi.encodeCall(__action, (popArgs, payer))`. In rule-pays, `payer == address(this)` (the
  rule contract). In caller-pays (mode 1), `payer = FRAMEPARAM(0x00, 1)`: the target of the payer's VERIFY frame, which
  Core requires to be another account with flags 1 (`0x43`, `0x44`) and which approved and paid for the transaction. It
  is never taken from popArgs, so a reward to `payer` goes to whoever paid; a copied transaction pays whoever pays for
  the copy.

## Caller-pays layout (mode 1)

```
frame 0  VERIFY  flags 2  target null (rule contract)   data verifyData       Core: checks, key, condition, APPROVE(2)
frame 1  VERIFY  flags 1  target payer (≠ rule contract) data payer's choice  payer: APPROVE(1); consumes the key (+20,000 first use)
frame 2  SENDER  flags 0  target null (rule contract)   data pop(popArgs)     Core: __action(popArgs, payer), limits pinned
frame 3  DEFAULT flags 0  target ≠ rule contract, value 0 (optional)          the payer's own follow-up
EOA payer: signatures = [ARBITRARY empty (placeholder), SECP256K1 signer=payer, msg empty, over the sig hash]
```

Full check list: `LAYOUT.md` "VERIFY, caller-pays". Fee caps are not used in mode 1 (the factory requires 0).

## Rules for logic contracts

- Every reserved function must revert when called directly: `require(address(this) != __self)` with
  `address immutable __self = address(this)` set in the constructor. Under DELEGATECALL `address(this)` is the rule
  contract.
- `__nonceKey` and `__condition` run in a static context (VERIFY): no SSTORE, LOG, CREATE, value. They may read the rule
  contract's own storage (the delegatecall's storage context), which needs no stake. Banned opcodes (TIMESTAMP, NUMBER,
  BALANCE, SELFBALANCE, TLOAD, GAS not before a CALL, …) make the transaction non-canonical.
- `__nonceKey` must return a non-zero key, and each key fires once (Core requires `nonce_seq == 0`). The number of keys
  for which the condition is true is the number of transactions anyone can make the rule contract pay for: derive the
  key from state the action advances (an epoch counter), not from popArgs alone.
- `__condition` must return exactly `true` (the word 1). Anything else, a revert, or out-of-gas makes the transaction
  invalid, and nobody pays.
- Logic must not call APPROVE. If it did, Core's own `APPROVE` would be a second approval, an exceptional halt, and the
  transaction would be invalid.
- New storage slots written in `__action` cost 97,920 state gas each. The SENDER frame's limits are pinned to exactly
  `maxGasPerFrame` / `maxStateGasPerFrame` (`0x15`, `0x17`), so those caps are the action's whole budget: set them to
  what `__action` needs (unused gas is refunded).
- `__action` may send ETH to `payer` / `address(this)` with empty calldata: Core accepts empty-calldata calls from any
  caller, itself included (STOP). A non-empty call from logic to `address(this)` re-enters the SENDER routine, which
  rejects it with `0x37` (transient lock at `keccak256("popcorn.core.lock")`; logic must not TSTORE that slot), so
  `__action` runs once per transaction.
- The VERIFY limit must be ≥ `10,000 + conditionGas + conditionGas/63 + 7,000 + len(verifyData) + len(frame 1 data)`
  (`0x27`, `LAYOUT.md` "VERIFY floor"), so `__condition` always gets its whole `conditionGas`. Send
  `max(floor, simulated VERIFY use + margin)`: the 20,000 nonce first-use charge comes after the condition.
- Ordinary (forwarded) functions: mark them `forwarded`, use internal calls rather than `address(this).fn()` (that
  reaches the SENDER routine, which reverts `0x3b` outside the rule contract's own transaction), never call them from the
  condition (they may TLOAD), and keep their state in the logic's own ERC-7201 namespace. `msg.sender` is the external
  caller.
- **An action must never revert for a reason the payer (or any outsider) controls.** The key is consumed at payment
  approval, before `__action`; if the action reverts, whatever it would have advanced (the state the next key derives
  from) does not move, and a rule contract whose key only advances in its action is bricked. Advance the key's state
  first, make external calls low-level and checked, and record-and-return instead of reverting. Caller-pays rewards are
  best effort (fixed gas; on failure the reward is owed and claimable).
- Solidity logic should inherit `RuleContract`, which implements these rules.
