# Popcorn Core: immutable arguments, constants, error codes

## Deploying a rule contract

```
initcode      = PopcornCore.bin ++ args ++ ownerInit     (args = exactly 101 bytes, below; ownerInit = 84 bytes, "Owner init")
deployed code = PopcornCore.runtime.bin ++ args          (ownerInit is NOT kept in the code)
```

The deploy code reverts unless the initcode is exactly `datasize(PopcornCore) + 101 + 84` bytes long, `logic` has
code, `mode <= 1`, and the owner init is either all zero or has all three fields non-zero. It accepts value. The
runtime reads each argument with `CODECOPY` at `datasize("runtime") + offset` (`arg()`).

## Argument layout (101 bytes, packed, big-endian)

| Offset | Bytes | Name | Type | Meaning |
|---|---|---|---|---|
| 0 | 20 | `logic` | address | the developer's logic contract; Core only DELEGATECALLs it |
| 20 | 1 | `mode` | uint8 | 0 rule-pays, 1 caller-pays. Deploy rejects anything else |
| 21 | 16 | `maxFeePerGas` | uint128 | cap on the tx's `max_fee_per_gas` (mode 0; unused in mode 1, the factory requires 0) |
| 37 | 16 | `maxPriorityFeePerGas` | uint128 | cap on the tx's `max_priority_fee_per_gas` (mode 0; unused in mode 1, the factory requires 0) |
| 53 | 8 | `maxGasPerFrame` | uint64 | frame 0 execution limit ≤ it; **SENDER frame execution limit == it** (frame 1, or 2 in mode 1) |
| 61 | 8 | `maxStateGasPerFrame` | uint64 | **SENDER frame state limit == it**; frame 0 state limit == 0 |
| 69 | 20 | `verifier` | address | not read by Core; available to logic (the rule-set engine stores its config pointer here) |
| 89 | 4 | `conditionGas` | uint32 | fixed gas forwarded to `__condition` |
| 93 | 4 | `maxVerifyDataLength` | uint32 | max bytes of frame 0 data (verifyData) |
| 97 | 4 | `maxPopArgsLength` | uint32 | max bytes of popArgs (the trigger data) |

Solidity: `abi.encodePacked(logic, uint8(mode), uint128(maxFee), uint128(maxTip), uint64(maxGas), uint64(maxState),
verifier, uint32(conditionGas), uint32(maxVerifyDataLength), uint32(maxPopArgsLength))`.

**Why the SENDER frame's limits are pinned.** Anyone can build a transaction. With "≤ cap", a griefer could set the
SENDER execution (or state) limit to 0: VERIFY still approves, APPROVE consumes the nonce key and debits the rule
contract, and the action never runs. Pinning to the cap costs nothing, because unused gas is refunded to the payer. So
`maxGasPerFrame` / `maxStateGasPerFrame` are *the* SENDER budget: set them to what `__action` needs. In caller-pays the
payer pays for the pinned limits, but a starved action would still consume the rule contract's nonce key (and the
rescue it guards), so mode 1 keeps the pinning (`0x15`, `0x17` on frame 2).

**Why frame 0 is only capped.** Frame 0's gas is spent only on VERIFY. Too little makes VERIFY fail, which makes the
transaction invalid: nobody pays and the key is not consumed, so it cannot be used to grief. More than needed is
refunded. Its state limit must be 0 (VERIFY is static).

## VERIFY floor (check `0x27`)

```
frame 0 execution limit ≥ NONCE_KEY_GAS + conditionGas + conditionGas / 63 + VERIFY_FIXED_GAS + n0 + n1
                        = 10,000 + conditionGas + conditionGas / 63 + 7,000 + len(verifyData) + len(frame 1 data)
```

With a smaller limit `__condition` could get less than `conditionGas`. A condition that only fails closed on
out-of-gas is safe either way, but one that treats a failed sub-call as "true" (for example `try oracle.read() …
catch { return true; }`) could be made to fail **open** by a caller who picks a low VERIFY limit. Core cannot read
`GAS` in VERIFY (banned unless right before a CALL), so it bounds the declared limit (`FRAMEPARAM(0x01, 0)`) instead.

The floor guarantees the condition's budget, not that the transaction succeeds: the 20,000 first-use charge of the
nonce key is taken at payment approval, after the condition. An honest transaction declares
`max(floor, simulated VERIFY use + margin)`; below its use it is merely invalid (nobody pays).

## Deploy bounds (enforced by `RuleFactory`; Core itself does not)

| Field | Recommended | Reason |
|---|---|---|
| `maxFeePerGas` | > 0, ≥ the expected base fee, and the rule contract balance ≥ maxFee × max gas of one transaction | 0 means nothing can ever be included |
| `maxPriorityFeePerGas` | ≤ `maxFeePerGas` | larger is unreachable |
| `maxGasPerFrame` | ≥ the VERIFY floor at the data caps and ≥ `__action` need; ≤ 16,777,216 (EIP-7825 tx cap; the SENDER limit equals it) | it is both the VERIFY cap and the exact SENDER budget |
| `maxStateGasPerFrame` | 97,920 × the new slots `__action` can create (0 if none) | the exact SENDER state budget |
| `conditionGas` | 5,000 ≤ x and `10,000 + x + x/63 + 7,000 + maxVerifyDataLength + 68 + ceil32(maxPopArgsLength)` ≤ `maxGasPerFrame` | below 5k nothing useful runs; above, nothing at the data caps can meet the `0x27` floor |
| all of the above | `12,950 + 16 × (maxVerifyDataLength + 68 + ceil32(maxPopArgsLength) + 35) + floor + maxGasPerFrame` ≤ 2^24 | EIP-7825 / EIP-8141: intrinsic + Σ execution limits ≤ 16,777,216 (state excluded) |
| `maxVerifyDataLength` | 0 when the condition ignores verifyData; else the exact proof/hint size (a Groth16 proof ≈ 256–384 bytes) | each byte costs the rule contract up to 64 gas |
| `maxPopArgsLength` | the exact popArgs size the logic decodes (for example 32 or 64) | same |

## Constants (in the bytecode)

| Name | Value | Why |
|---|---|---|
| `SEL_POP` | `0xd9292504` | `pop(bytes)`, the SENDER frame's calldata selector |
| `SEL_NONCE_KEY` | `0x97031c8c` | `__nonceKey(bytes)` |
| `SEL_CONDITION` | `0x05f661f0` | `__condition(bytes,bytes)` |
| `SEL_ACTION` | `0x6019566d` | `__action(bytes,address)` |
| `NONCE_KEY_GAS` | 10,000 | fixed gas for `__nonceKey`. An epoch key costs about 3,200, two cold SLOADs + hash about 5,400 |
| `VERIFY_FIXED_GAS` | 7,000 | VERIFY floor allowance besides the two calls |
| `LOCK_SLOT` | `keccak256("popcorn.core.lock")` | transient slot of the SENDER re-entry lock; logic must not TSTORE it |
| `MANDATORY_GAS` | 12,950 | 12,000 intrinsic + 2 × 475 per frame |
| `FLOOR_PER_BYTE` | 64 | EIP-7976 floor: 4 tokens per byte × 16 gas per token |
| `NONCE_RLP_BYTES` | 35 | max `len(rlp([key]) ‖ rlp(0))` for one key of ≤ 32 bytes |

### Check `0x1a` (total debit bound)

EIP-8141 prices a transaction as `mandatory_gas = 12,000 + 475 × frames + signature cost + 6,000 × value frames`;
`data_cost` = 4 per zero / 16 per non-zero byte over every frame's data, signature fields,
`rlp(nonce_keys) ‖ rlp(nonce_seq)` and `rlp(recent_root_references)`; floor `64 × bytes`;
`total_gas_limit = max(mandatory + data_cost + roots + Σexec + Σstate, mandatory + roots + 64 × bytes + Σstate)`;
TXPARAM `0x06` max cost = `total_gas_limit × max_fee_per_gas` (+ blobs).

Core has already required 2 frames, no signatures, no value, no roots, no blobs (`0x05`, `0x0c`, `0x18`, `0x19`,
`0x23`, `0x0d`), so `mandatory = 12,950`, `bytes ≤ n0 + n1 + 35`, and since `data_cost ≤ 64 × bytes`:

```
total_gas_limit ≤ 12,950 + 64 × (n0 + n1 + 35) + exec0 + exec1 + state0 + state1
```

Check `0x1a` requires `TXPARAM(0x06) ≤ TXPARAM(0x04) × (that bound)` with the transaction's actual limits and data
lengths. With the per-field checks it always holds under today's pricing, and it fails closed if a future intrinsic
term makes the transaction cost more. The most anyone can make the rule contract reserve per transaction is
`maxFeePerGas × (12,950 + 64 × (maxVerifyDataLength + 68 + ceil32(maxPopArgsLength) + 35) + 2 × maxGasPerFrame +
maxStateGasPerFrame)`; the actual charge is the gas used (unused gas is refunded) but never below the 64 gas/byte floor.

## Error codes (32-byte revert data)

### VERIFY, rule-pays (`verifyFrame`, caller 0xaa), in execution order

| Code | Check |
|---|---|
| `0x01` | `mode == 0` after the mode-1 dispatch; defense in depth, deploy rejects mode > 1 |
| `0x02` | `TXPARAM(0x0a) == 0`: executing frame is frame 0 |
| `0x03` | frame 0 mode is VERIFY (DEFAULT also has caller 0xaa) |
| `0x04` | `TXPARAM(0x02) == address()`: tx.sender is this rule contract |
| `0x05` | `TXPARAM(0x09) == 2`: exactly two frames |
| `0x06` | frame 0 target is self |
| `0x07` | frame 0 flags == 3 |
| `0x08` | frame 1 mode is SENDER |
| `0x09` | frame 1 target is self |
| `0x0a` | frame 1 flags == 0 |
| `0x0b` | `TXPARAM(0x0e) == 1`: exactly one nonce key |
| `0x0c` | `TXPARAM(0x0b) == 0`: no signatures |
| `0x0d` | `TXPARAM(0x07) == 0`: no blobs |
| `0x23` | `TXPARAM(0x11) == 0`: no recent-root references |
| `0x24` | frame 0 data length ≤ `maxVerifyDataLength` |
| `0x0e` | frame 1 data starts with `pop(bytes)` |
| `0x0f` | popArgs offset word == 0x20 |
| `0x10` | popArgs length < frame 1 data length |
| `0x11` | frame 1 data length == 68 + ceil32(len) (canonical, nothing trailing) |
| `0x25` | popArgs length ≤ `maxPopArgsLength` |
| `0x26` | popArgs ABI padding bytes are zero |
| `0x12` | `max_fee_per_gas ≤ maxFeePerGas` |
| `0x13` | `max_priority_fee_per_gas ≤ maxPriorityFeePerGas` |
| `0x14` | frame 0 execution limit ≤ `maxGasPerFrame` |
| `0x27` | frame 0 execution limit ≥ the VERIFY floor: `10,000 + conditionGas + conditionGas/63 + 7,000 + n0 + n1` |
| `0x15` | frame 1 execution limit **==** `maxGasPerFrame` |
| `0x16` | frame 0 state limit == 0 |
| `0x17` | frame 1 state limit **==** `maxStateGasPerFrame` |
| `0x18` | frame 0 value == 0 |
| `0x19` | frame 1 value == 0 |
| `0x1a` | total debit bound from the transaction's actual limits and data lengths (above) |
| `0x1b` | `DELEGATECALL(10,000, logic, __nonceKey(popArgs))` succeeded |
| `0x1c` | it returned exactly 32 bytes |
| `0x1d` | key != 0 |
| `0x1e` | `TXPARAM(0x10) == key`: the transaction's nonce key is the logic's key |
| `0x1f` | `TXPARAM(0x01) == 0`: nonce sequence 0 |
| `0x20` | `DELEGATECALL(conditionGas, logic, __condition(popArgs, verifyData))` succeeded; verifyData = frame 0 data |
| `0x21` | it returned exactly 32 bytes |
| `0x22` | the word is exactly 1 |
| — | `APPROVE(0, 0, 3)`: execution + payment, last; ends the frame |

### VERIFY, caller-pays (`verifySenderPays`, mode 1), in execution order

The shared checks above (`0x02`-`0x04`, `0x06`, `0x0b`, `0x0d`, `0x23`-`0x26`, `0x0e`-`0x11`, `0x14`, `0x27`,
`0x15`-`0x19`, `0x1b`-`0x22`) apply to the frames of this layout. Not checked in mode 1: the fee caps (`0x12`, `0x13`,
`0x1a`; the rule contract never pays) and "no signatures" (`0x0c`; the payer may sign). Then `APPROVE(0, 0, 2)`:
execution only.

| Code | Check |
|---|---|
| `0x40` | `TXPARAM(0x09)` is 3 or 4: frames = rule contract VERIFY, payer VERIFY, SENDER, optional tail |
| `0x41` | frame 0 flags == 2 (execution scope only: the rule contract can never be the payer) |
| `0x42` | frame 1 (payer) mode is VERIFY |
| `0x43` | frame 1 target is not the rule contract (the payer is another account) |
| `0x44` | frame 1 flags == 1 (payment scope only) |
| `0x45` | frame 2 mode is SENDER |
| `0x46` | frame 2 target is self |
| `0x47` | frame 2 flags == 0 (no approval scope, no atomic batch with the tail) |
| `0x48` | frame 3 (tail) mode is DEFAULT (a second SENDER frame would run as the rule contract) |
| `0x49` | frame 3 target is not the rule contract |
| `0x4a` | frame 3 flags == 0 |
| `0x4b` | frame 3 value == 0 |

### SENDER (`senderFrame`, caller == address(), non-empty calldata)

| Code | Check |
|---|---|
| `0x30` | the executing frame is a SENDER frame |
| `0x3b` | `TXPARAM(0x02) == address()`: tx.sender is this rule contract |
| `0x3c` | `TXPARAM(0x0a) == mode + 1`: the executing frame is the transaction's SENDER frame, frame 1 (mode 0) or 2 (mode 1) |
| `0x31` | `mode < 2` (deploy guarantees it) |
| `0x37` | re-entry lock: `TLOAD(LOCK_SLOT) == 0`, then `TSTORE(LOCK_SLOT, 1)`; cleared after `__action` returns |
| `0x32`-`0x35` | calldata encoding, same rules as `0x0e`-`0x11` |
| `0x36` | popArgs ABI padding is zero (same as `0x26`) |

Then `__action(popArgs, payer)` by DELEGATECALL with all gas; `payer = address()` in mode 0 and
`FRAMEPARAM(0x00, 1)` (the payer VERIFY frame's target) in mode 1. A revert is bubbled verbatim.

**Re-entry.** `__action` runs in the rule contract's context, so a non-empty CALL from it to `address(this)` has
caller == self and reaches the SENDER routine again. The transient lock makes that inner call revert with `0x37`, so
`__action` runs once per transaction.

### FORWARD: any caller other than 0xaa and self, non-empty calldata

| Code | Check |
|---|---|
| `0x3a` | calldata is at least 4 bytes (a selector) |
| `0x38` | selector is none of `__nonceKey` `0x97031c8c`, `__condition` `0x05f661f0`, `__action` `0x6019566d`, `pop` `0xd9292504` |
| `0x39` | SENDER lock not set: no forwarded call while `__action` runs |

Then DELEGATECALL to logic with all gas, value kept, return or revert bubbled.

**Forward-path properties.**
- A forwarded function that calls `address(this)` cannot reach `__action`: the SENDER routine requires
  `tx.sender == address()` (`0x3b`) and the transaction's own SENDER frame index (`0x3c`), so another account's frame
  transaction cannot run this rule contract's action.
- The hooks are reachable only from Core (`0x38`), and no forwarded call runs inside an action (`0x39`).

### Dispatch

| Case | Result |
|---|---|
| caller 0xaa | VERIFY routine (any calldata, empty verifyData included); revert if it ever returns |
| any other caller, empty calldata | STOP: accept ETH, including the rule contract paying itself from `__action` |
| caller == self, non-empty calldata | SENDER routine |
| anything else | FORWARD to logic |

## Owner init (initcode only)

| Init offset | Init bytes | Init name | Init type | Init meaning |
|---|---|---|---|---|
| 0 | 20 | `ownerEcdsa` | address | the owner's ECDSA address (ecrecover of the sig hash must return it) |
| 20 | 32 | `wotsRoot` | bytes32 | Merkle root of the owner's WOTS+ tree (height 10, 1,024 one-time keys) |
| 52 | 32 | `wotsPubSeed` | bytes32 | public seed of the tweakable hash |

All zero = no owner: the owner path answers `0x5d`.

## OWNER: ECDSA + WOTS+ authorised calls

An owner transaction is a separate shape, not a trigger. It is approved only with **both** an ECDSA and a WOTS+
(hash-based, post-quantum) signature over the same signature hash `h = TXPARAM(0x08)`, which covers every other byte
of the transaction. Both signatures sit in ARBITRARY signature entries with an empty `msg`, so their bytes are elided
from the hash; no frame data carries a signature.

```
mode 0: [0] VERIFY flags 3 -> rule contract   (approves execution AND payment)
        [1] SENDER flags 0 -> rule contract, data ownerBump()      (spends the WOTS leaf)
        [2] SENDER flags 0 -> rule contract, data owner(bytes call)
mode 1: [0] VERIFY flags 2 -> rule contract, [1] VERIFY flags 1 -> payer (!= rule contract), [2] bump, [3] owner call
```

The owner call runs on the logic by DELEGATECALL with a transient owner flag set, which `onlyOwnerCall` functions
check. Rotation is two-step: `ownerRotate` stages the new owner in slots `B+3`..`B+5`, and the old keys stay valid until
a transaction signed by the new keys lands.

Storage at `B = keccak256("popcorn.core.owner")`:

| Slot | Content |
|---|---|
| `B` | `ownerEcdsa` (bits 0..159) `\|` `wotsIndex << 160` (the first leaf the next owner transaction may use; starts at 0) |
| `B+1` | `wotsRoot` |
| `B+2` | `wotsPubSeed` |
| `B+3`..`B+5` | the PENDING owner (same layout); all zero unless a rotation is staged |

### OWNER path (`verifyOwner`, `senderOwnerBump`, `senderOwnerCall`)

| Code | Check |
|---|---|
| `0x50` | owner tx frame count: `TXPARAM(0x09) == mode + 3` |
| `0x51` | the nonce key is OWNER_KEY |
| `0x52` | signature count: mode 0 exactly 2, mode 1 at least 2 |
| `0x53` | owner call longer than 1,024 bytes |
| `0x54` | owner call shorter than 4 bytes (no selector) |
| `0x55` | owner call selector is reserved (pop, `__nonceKey`, `__condition`, `__action`, `owner`, `ownerBump`) |
| `0x56` | bump frame execution limit outside 30,000..100,000 |
| `0x57` | ECDSA entry (`signatures[n-2]`) scheme is not ARBITRARY |
| `0x58` | ECDSA entry msg is not empty |
| `0x59` | ECDSA entry is not exactly 65 bytes |
| `0x5a` | WOTS entry (`signatures[n-1]`) scheme is not ARBITRARY |
| `0x5b` | WOTS entry msg is not empty |
| `0x5c` | WOTS entry is not exactly 2,496 bytes |
| `0x5d` | no owner configured (`ownerEcdsa == 0`) |
| `0x5e` | VERIFY data is not empty |
| `0x5f` | ecrecover of the sig hash is not the owner's ECDSA address |
| `0x60` | WOTS leaf is not below 1,024 |
| `0x61` | WOTS leaf is below `wotsIndex` (spent) |
| `0x62` | WOTS+ signature or Merkle path does not verify against `wotsRoot` |
| `0x63` | owner call frame: the bump frame before it did not succeed |
| `0x65` | bump data is not exactly the `ownerBump()` selector (VERIFY and the bump frame) |
| `0x66` | call frame mode is not SENDER |
| `0x67` | call frame target is not the rule contract |
| `0x68` | call frame flags are not 0 |
| `0x69` | call frame data does not start with `owner(bytes)` |
| `0x6a` | ECDSA signature is malleable: `v` is not 27/28 or `s` is above n/2 |

SENDER-side dispatch: after `0x30`, `0x3b`, `0x3c` (the executing frame is `mode + 1` for a trigger and for the bump,
`mode + 2` for the owner call) and the lock check `0x37`, selector `ownerBump()` runs `senderOwnerBump` (reads the leaf
from the last signature entry with `SIGDATACOPY`, writes `wotsIndex`, `STOP`), and selector `owner(bytes)` takes the
lock and runs `senderOwnerCall`. Everything else is the trigger path.

## Memory in VERIFY

`0x00` scratch for `arg()`; `0x20` return word; `0x80` `__nonceKey` calldata (`selector ++ frame1.data[4:]`); then, at
`0x80 + ceil32(len(frame1.data))`, the `__condition` calldata, built in fresh memory so ABI padding is zero.
