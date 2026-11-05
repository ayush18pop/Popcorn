# Popcorn Core: EIP-8141 reference values

The opcode bytes, parameter ids, approval rules, gas formulas and mempool rules Core is built against, with their
source in the reference client.

Sources:

- **ethrex** = `github.com/forshtat/ethrex`, branch `eip8141-tracer`, commit `9aa3645d795945c64400f41a70aace0edfa7f383`.
  `frame_tx.rs` = `crates/vm/levm/src/opcode_handlers/frame_tx.rs`, `tx.rs` = `crates/common/types/transaction.rs`,
  `vm.rs` = `crates/vm/levm/src/vm.rs`.
- **sidecar** = `github.com/forshtat/mempool-workshop-sidecar` (the ERC-8421 mempool node).
  `frameTx.ts` = `packages/executor/src/services/UserOpValidation/validators/frameTx.ts`.
- Where ethrex's own `docs/eip-8141.md` disagrees with the code (old RLP layout, SIGPARAM copy), the code wins.

---

## 1. Opcodes

Bytes: `opcodes.rs:176-190` (enum) and `:361-368` (table), pinned by compile-time asserts at `:208-221`.
All halt exceptionally outside a frame transaction.

| Opcode | Byte | Stack in (top first) | Out | Gas | Source |
|---|---|---|---|---|---|
| `APPROVE` | `0xAA` | `offset, length, scope` | none; halts the frame like `RETURN`, output = `mem[offset..offset+length]` | memory expansion only | `frame_tx.rs:254-312` |
| `TXPARAM` | `0xB0` | `param_id` | `value` | 2 | `frame_tx.rs:358-401`, `load_tx_param` `:783-838` |
| `FRAMEDATALOAD` | `0xB1` | `offset, frameIndex` | 32-byte word of `frames[frameIndex].data`, zero-padded | 3 | `frame_tx.rs:407-450` |
| `FRAMEDATACOPY` | `0xB2` | `memOffset, dataOffset, length, frameIndex` | none (copies, zero-pads) | CALLDATACOPY model (3 + 3/word + memory) | `frame_tx.rs:456-512` |
| `FRAMEPARAM` | `0xB3` | `frameIndex, param` | `value` | 2 | `frame_tx.rs:518-620` |
| `SIGPARAM` | `0xB4` | `signatureIndex, param` | `value` | 2 | `frame_tx.rs:626-686` |
| `SIGDATACOPY` | `0xB5` | `memOffset, dataOffset, length, signatureIndex` | none; ARBITRARY signatures only, else halt | CALLDATACOPY model | `frame_tx.rs:692-745` |
| `RECENTROOTREFLOAD` | `0xB6` | `field, index` | `field` 0 source_id, 1 slot, 2 root of `recent_root_references[index]` | 3 | `frame_tx.rs:747-781`, `docs/eip-8272.md` |

There is no separate "frame data size" opcode: use `FRAMEPARAM(0x04, i)`.
Out-of-range `frameIndex` / `signatureIndex` / `index` is an exceptional halt (even for a zero-length copy).

**Reading the SENDER frame's calldata from VERIFY** (what Core needs for `popArgs`): `FRAMEPARAM(0x04, 1)` for
the length, then `FRAMEDATACOPY(mem, 0, len, 1)`. Any frame's data is readable from any frame.

**Yul.** Solidity cannot emit these. Use `verbatim_<n>i_<m>o(hex"..", a, b, ...)`, where the *first* argument
ends up on top of the stack (`verbatim_3i_0o(hex"aa", 0, 0, 3)` compiles to `6003 5f 5f aa`). The wrappers Core
uses:

```yul
function txparam(id) -> v { v := verbatim_1i_1o(hex"b0", id) }
function frameparam(param, idx) -> v { v := verbatim_2i_1o(hex"b3", idx, param) }      // idx on top
function framedataload(off, idx) -> v { v := verbatim_2i_1o(hex"b1", off, idx) }       // offset on top
function framedatacopy(mem, off, len, idx) { verbatim_4i_0o(hex"b2", mem, off, len, idx) }
function approve(scope) { verbatim_3i_0o(hex"aa", 0, 0, scope) }                       // offset, length, scope
```

Toolchain: solc 0.8.33 `--strict-assembly` (`scripts/install-solc.sh`). There is no patched solc; nobody needs one.

## 2. TXPARAM ids (`frame_tx.rs:783-838`, constants pinned at `:330-356`)

| id | Value | Notes |
|---|---|---|
| `0x00` | tx type, always `0x06` | |
| `0x01` | `nonce_seq` | |
| `0x02` | `tx.sender` (right-aligned) | |
| `0x03` | `max_priority_fee_per_gas` | |
| `0x04` | `max_fee_per_gas` | |
| `0x05` | `max_fee_per_blob_gas` | |
| `0x06` | max cost = `max_fee_per_gas * total_gas_limit + blobs` | the amount APPROVE debits; `compute_tx_max_cost` `:52-65` |
| `0x07` | `len(blob_versioned_hashes)` | |
| `0x08` | signature hash (section 6) | |
| `0x09` | `len(frames)` (frame count) | |
| `0x0A` | index of the currently executing frame | |
| `0x0B` | `len(signatures)` | |
| `0x0C` | `state_gas_left` in the current frame | live value, `:376-386` |
| `0x0D` | sender's legacy account nonce | reading it in VERIFY marks the tx nonce-dependent, `:388-394` |
| `0x0E` | `len(nonce_keys)` | EIP-8250 |
| `0x0F` | `nonce_keys_hash` = keccak(len ‖ keys, 32-byte BE words) | `tx.rs` `nonce_keys_hash` |
| `0x10` | `nonce_keys[0]` | halts if empty (cannot be, static rule) |
| `0x11` | `len(recent_root_references)` | EIP-8272 |
| `0x12` | resolved payer, zero before payment approval | ethrex-only, gated on chain knob `payerTxparamTime`; **halts on the devnet**. Use `FRAMEPARAM(0x00, payerFrameIndex)` |
| other | exceptional halt | |

There is **no TXPARAM for "nonce key" in general and no per-frame gas limit**; those are FRAMEPARAM / `0x10`.

## 3. FRAMEPARAM params (`frame_tx.rs:518-620`), stack `frameIndex` on top, then `param`

| param | Value |
|---|---|
| `0x00` | resolved target (`frame.target`, or `tx.sender` when null) |
| `0x01` | `limits.execution` (the frame's execution gas limit) |
| `0x02` | mode (0 DEFAULT, 1 VERIFY, 2 SENDER) |
| `0x03` | flags |
| `0x04` | `len(data)` |
| `0x05` | status of an earlier frame (0 fail, 1 ok, 2 skipped); halts for current/future frames |
| `0x06` | allowed scope = `flags & 3` |
| `0x07` | atomic-batch bit, 0/1 |
| `0x08` | value |
| `0x09` | `limits.state` (state gas limit) |
| `0x0A` / `0x0B` | gas used (execution / state) of an earlier frame; halts for current/future |
| other | exceptional halt |

## 4. APPROVE

Scopes (`frame_tx.rs:85-250`, sidecar `packages/types/src/contracts/FrameTx.ts:8-13`):

| scope | Name | Effect |
|---|---|---|
| `0x0` | NONE | exceptional halt |
| `0x1` | PAYMENT | needs `sender_approved` already (else frame reverts, `:113-124`); consumes the nonce keys, debits max cost from the frame target, sets `payer = target` |
| `0x2` | EXECUTION | needs `target == tx.sender` (else revert, `:177-179`); sets `sender_approved` |
| `0x3` | EXECUTION + PAYMENT | both in one step; needs `target == tx.sender` (`:198-202`) |
| `>3` | | exceptional halt |

Rules (all `frame_tx.rs`):

- **Who:** the executing call frame's `to` must equal the frame's resolved target (`:271-277`), else revert.
  Under DELEGATECALL `to` stays the caller, so code delegatecalled by the target could call APPROVE; under CALL
  into another contract it cannot.
- **Which frame:** the requested scope must be a non-zero subset of the frame's `flags & 3` (`:279-288`), else
  exceptional halt. A frame with flags scope 0 can never approve. Nothing restricts APPROVE to VERIFY mode in the
  opcode; payment approval inside an atomic batch reverts (`:126-145`, `:204-212`). The validation prefix (the
  frames before payment is set) must be VERIFY frames for the mempools to recognise it (section 9).
- **Twice:** a second execution approval or a second payment approval is an exceptional halt (`:103-105`,
  `:174-176`, `:196-198`), which fails the VERIFY frame and invalidates the tx.
- **Insufficient balance** of the payer: the frame reverts (`:157-165`).
- **Reverting after APPROVE:** APPROVE halts the current call frame, so the top-level frame cannot run anything
  after it. If APPROVE ran in a nested call and the VERIFY frame then reverts, the tx is invalid (`vm.rs:3087-3100`:
  any failed VERIFY frame invalidates the tx). A SENDER frame that reverts after a successful prefix leaves the tx
  valid: the payer pays, the nonce stays consumed.
- **Order:** execution approval must come before payment approval (scope 1 checks `sender_approved`).
- **Gas:** APPROVE with payment scope pays `KEYED_NONCE_FIRST_USE_GAS = 20,000` per non-zero nonce key used for
  the first time (`vm.rs:1961-1997`, `gas_cost.rs:72`), charged to the frame that calls APPROVE.
- **Default code (EOA target, no code):** VERIFY approves the frame's allowed scope iff `signatures[0]` (scope
  includes execution) or `signatures[1]` (payment only) is a SECP256K1 signature with empty `msg` whose resolved
  signer is the frame target (`frame_tx.rs:877-923`). SENDER/DEFAULT to an EOA succeed doing nothing (`:857-874`).

## 5. Frame modes, flags, caller

`tx.rs:1915-1932` (`FrameMode`), caller per mode `vm.rs:2443-2475`.

| Mode | Value | Caller (`msg.sender`) | Static | Notes |
|---|---|---|---|---|
| DEFAULT | 0 | `ENTRY_POINT` = `0x00000000000000000000000000000000000000aa` | no | runs as an ordinary call from 0xaa; no sender authority |
| VERIFY | 1 | `ENTRY_POINT` (0xaa) | **yes** (no SSTORE/LOG/CREATE/value; APPROVE's own writes are exempt) | a failed VERIFY invalidates the tx; a VERIFY that does not APPROVE is still valid |
| SENDER | 2 | `tx.sender` | no | invalid tx if no frame has approved execution yet; may carry value |
| (UTXO) | 5 | | | EIP-8312, not for us; 3 and 4 reserved |

Flags (`tx.rs:1951-1956`, `:1984-1995`): bits 0-1 = allowed APPROVE scope, bit 2 = atomic batch (`0x4`, DEFAULT and
SENDER only), bits 3-7 must be zero.

Core can tell VERIFY from DEFAULT only with `FRAMEPARAM(0x02, TXPARAM(0x0A))`; both have caller 0xaa.

## 6. Transaction type, RLP, signature hash

Type byte **`0x06`** (`tx.rs` `TxType::Frame`; TXPARAM 0x00; sidecar `FRAME_TX_TYPE`).

Wire: `0x06 || rlp([...])` (`tx.rs:3444-3461`, sidecar `codec.ts:141-154`, identical order):

```
[ chain_id,
  nonce_keys,              # list of uint256, 1..16, strictly increasing; [0] = legacy account nonce
  nonce_seq,               # uint64, < 2^64-1
  sender,                  # 20 bytes
  frames,                  # list of [mode, flags, target, [limit_execution, limit_state], value, data]
                           #   target = 20 bytes or empty bytes (= tx.sender)
  signatures,              # list of [scheme, signer, msg, signature]
                           #   scheme 0 ARBITRARY (signer empty), 1 SECP256K1 (65 B, v||r||s, v in {0,1}, low s),
                           #   2 P256 (128 B r||s||qx||qy); signer empty = tx.sender; msg empty or 32-byte digest
  [max_priority_fee_per_gas, max_fee_per_gas, max_fee_per_blob_gas],   # a nested list
  blob_versioned_hashes,   # list of 32-byte hashes
  recent_root_references ] # list of [source_id(32), slot(uint64), root(32)], 0..16
```

Integers are minimal big-endian (0 = empty string). Frame encoding `tx.rs:2008-2023`; fields of `Frame`
`tx.rs:1959-1981`.

**Signature hash** (`tx.rs:2372-2417`, sidecar `codec.ts:190-199`): `keccak256(0x06 || rlp(tx))` with exactly one
change: every signature entry whose `msg` is empty has its `signature` bytes replaced by empty bytes. **Frame data
is NOT excluded, including VERIFY frame data** (the code comment says so explicitly: "Frame data is NO LONGER
elided"). Agent 5 relied on this on chain.

> This changes the implementation plan: "VERIFY frame data excluded from the signature hash" is wrong for this
> devnet. Data that must be added after someone signs (a proof, a WOTS signature) goes in an ARBITRARY signature
> entry with empty `msg`, readable with `SIGPARAM`/`SIGDATACOPY`. For rule-pays pops there are no signatures at
> all, so nothing signs the sig hash and `verifyData` in the VERIFY frame is fine. Section 13.

## 7. Nonces (EIP-8250)

- `nonce_keys` 1..16 strictly increasing; key 0 only alone (= legacy linear nonce). `nonce_seq < 2^64-1`.
  Static rules `tx.rs` `validate_static_constraints`; sidecar `FrameTx.ts:138-168`.
- A non-zero key's sequence lives in `NONCE_MANAGER` = `0x0000000000000000000000000000000000008250` at slot
  `keccak256(pad32(sender) ‖ key)`; absent = 0 (`vm.rs:1924-1949`).
- Before any frame runs, `current_seq(sender, key) == nonce_seq` must hold for every key, else the tx is invalid
  (`Nonce mismatch: expected 2, got 1`).
- Consumption happens **at payment approval** (scope 1 or 3), not at execution approval: each key is set to
  `nonce_seq + 1`, and a key going 0 → non-zero costs **20,000 gas** charged to the approving frame
  (`vm.rs:1951-1997`). So in caller-pays mode the rule contract's key is consumed in the payer's VERIFY frame and the
  20,000 counts against the **payer's** frame limit.
- "Sequence 0" is not a protocol rule; Core must check `TXPARAM(0x01) == 0` itself, otherwise a used key at seq 1
  passes.
- Same `(sender, key set, seq)` in the mempool:
  - public ethrex: replacement iff both `max_fee_per_gas` and `max_priority_fee_per_gas` rise by ≥ 10%
    (`crates/blockchain/mempool.rs:109-123`, `:2553-2600`); a partial key overlap is rejected
    (`FrameTxSenderAlreadyPending`, `docs/eip-8250.md:61`).
  - sidecar: identical tx → `Frame transaction already known`; same slot with both fees ≥ +10% → replaces; else
    `Frame transaction cannot be replaced: fee too low` (`MempoolService/service.ts:484-512`,
    `entities/FrameTxMempoolEntry.ts:175-211`); another tx sharing any key at a different slot → `nonce key ... is
    already held by pending transaction` (`service.ts:384-406`).
  - **Anyone can replace a pending trigger** (there is no signature), by paying 10% more. Core's fee caps bound how
    much a griefer can raise the rule contract's cost. A copycat can also swap `popArgs` (for example a reporter
    address) in a replacement, so "reward the reporter named in popArgs" is front-runnable unless the nonce key
    commits to the reporter.
- On chain: the second tx with a consumed key is invalid (`Nonce mismatch: expected 1, got 0`).

## 8. Gas accounting (`tx.rs:2195-2640`, constants pinned `:2221-2232`)

```
mandatory   = 12,000 (FRAME_TX_INTRINSIC_COST)
            + 475 * len(frames)
            + signature cost (100 ARBITRARY, 2,800 SECP256K1, 6,700 P256, each)
            + 6,000 per frame with value != 0
data_cost   = 4 per zero byte, 16 per non-zero byte over: every frame's data, every signature's signer/msg/signature,
              rlp(nonce_keys)||rlp(nonce_seq), rlp(recent_root_references)
roots       = 0, or 2,400 + 2,002 * len(recent_root_references)
standard    = mandatory + data_cost + roots + Σ limits.execution + Σ limits.state
floor       = mandatory + roots + 64 * (number of bytes in the same data fields)     # 4 tokens/byte * 16
total_gas_limit = max(standard, floor + Σ limits.state)
max_cost    = total_gas_limit * max_fee_per_gas            # TXPARAM 0x06, what APPROVE debits
```

- Each frame runs with its own `limits.execution` and `limits.state` (EIP-8037 two-dimensional gas; new storage
  slots and accounts draw on `limits.state`). There is no tx-level gas limit field: the total is derived.
- A frame that REVERTs is charged its gas used; an exceptional halt charges the frame's full limit. Unused gas is
  refunded to the payer at the effective price; intrinsic is never refunded.
- **Verify prefix gas** (what the 100k / 250k budgets compare) is the sum of the **declared** `limits.execution`
  of the prefix frames plus the signature cost, not gas actually used. ethrex: `FRAME_TX_MAX_VERIFY_GAS =
  100_000` (`tx.rs:2249`), the default of ethrex's `--mempool.max-verify-gas` flag (`cmd/ethrex/cli.rs:276-284`,
  `crates/blockchain/blockchain.rs:454`; a local node can raise it); sidecar: `sumVerifyGasPerEntity` (`validationPrefix.ts:28-48`; signature cost counted
  to the sender). State limits of the prefix are capped separately at 500,000 (`validationPrefix.ts:82`).
- The 20,000 first-use charge for a new nonce key falls inside the paying VERIFY frame's limit.

## 9. Mempool rules

### Budgets enforced by the public endpoints

| Endpoint | Budget | Evidence |
|---|---|---|
| public ethrex `eth_sendRawTransaction` (`https://altmempool.forshtat.com`) | flat **100,000** for the whole prefix incl. signature cost | prefix 100,001 → `Invalid params: Frame transaction prefix gas budget (frames + sig cost) exceeds MAX_VERIFY_GAS` (-32000) |
| upstream sidecar (`https://altmempool.forshtat.com/rpc`) | flat **100,000** | prefix 100,001 → `validation prefix execution gas sum 100001 + signature-verification cost 0 = 100001 exceeds MAX_VERIFY_GAS 100000` (-32602); same at 250,001 |
| public gateway sidecar (`https://altmempoolgateway.forshtat.com/rpc`) | flat **100,000** | same message as the upstream sidecar |
| a sidecar with per-entity budgets (ERC-8421 BUDGET-010, as on the local devnet) | **250,000** unstaked / **2,500,000** staked, per entity | `exceeds unstaked / staked budget` |

On the public devnet anything with a prefix over 100k cannot be included through public paths. The 250k / 2.5M
per-entity budgets (the values on altmempool.wtf) hold on a sidecar configured with them, such as the local devnet.

### Recognised prefix shapes (sidecar `validationPrefix.ts:182-255`; ethrex reports `prefixShape`)

- Self relay: `[VERIFY flags 3 → sender]` (ethrex `SelfVerify`). **Rule-pays.**
- Canonical paymaster: `[VERIFY flags 2 → sender, VERIFY flags 1 → payer]` (ethrex `OnlyVerifyPay`). **Caller-pays.**
- Each approving frame may be preceded by a DEFAULT `pre_verify` frame with the same target; an optional leading
  `deploy` DEFAULT frame; an optional leading expiry-verifier frame (VERIFY flags 0 → `0x…8141`).
- After the prefix: any number of SENDER/DEFAULT frames, no further VERIFY frame (`validationPrefix.ts:333-338`).
- VERIFY flags 2/3 must target `tx.sender` or null (`validationPrefix.ts:299-308`).

### Validation trace rules (two layers)

**ethrex** (`canonicalMempoolValid` in the simulation; enforced by public ethrex admission) — `vm.rs:4181-4400`:
- Banned opcodes: `ORIGIN 0x32, GASPRICE 0x3A, BLOCKHASH 0x40, COINBASE 0x41, TIMESTAMP 0x42 (except inside
  0x…8141), NUMBER 0x43, PREVRANDAO 0x44, GASLIMIT 0x45, BASEFEE 0x48, BLOBHASH 0x49, BLOBBASEFEE 0x4A,
  SLOTNUM 0x4B, INVALID 0xFE, SELFDESTRUCT 0xFF, BALANCE 0x31, SELFBALANCE 0x47, TLOAD 0x5C, TSTORE 0x5D`,
  `CALLCODE` outside the deploy frame, and `GAS 0x5A` unless the next opcode is a `*CALL`.
- `SLOAD` only on storage whose owner (the executing frame's `to`, i.e. the storage context) is `tx.sender`
  (`vm.rs:4272-4302`, `validation_check_sload`). Under DELEGATECALL the storage context is the caller, so a rule contract's delegatecalled logic
  reading the rule contract's storage is allowed. Any other account's storage (including the payer's own) is a
  violation (`StorageReadNonSender`). There is no stake in ethrex's rules.
- SSTORE/CREATE only in the deploy frame (and only sender storage).
- CALL-family and `EXTCODE*` targets must exist (code, balance or nonce) or be a precompile, and not be
  EIP-7702-delegated; the sender is always allowed (`vm.rs:4348-4392`, `validation_check_call_target`). **DELEGATECALL is explicitly allowed**
  (`vm.rs:4189-4192`). Reading another contract's code is allowed if it exists.

**sidecar** (ERC-7562 port, `frameTx.ts:540-940`), applied per prefix frame to the whole call subtree:
- Banned: `GASPRICE GASLIMIT DIFFICULTY TIMESTAMP BASEFEE BLOCKHASH NUMBER SELFBALANCE BALANCE ORIGIN GAS
  COINBASE SELFDESTRUCT RANDOM PREVRANDAO INVALID BLOBHASH BLOBBASEFEE` (`frameTx.ts:71-90`);
  BALANCE/SELFBALANCE allowed for an entity with stake > minStake (strictly greater, `:726-731`). CREATE banned,
  CREATE2 only once in a factory (`:740-764`). Nested CALL with value banned (`:587-595`). `GAS` right before a
  `*CALL` is not flagged.
- Storage (`:766-834`): **the sender's own storage is always allowed** (`if (addr === sender) continue`).
  Accesses are keyed by storage address, so a DELEGATECALL reading the rule contract's slots counts as the rule contract's own
  storage. Any other address: reading needs the entity to be staked (`unstaked <role> accessed <addr> slot <s>`);
  writing another entity's storage is forbidden. A non-sender payer touching its **own** storage needs stake
  (`addr === entityAddr` → `requireStakeSlot`).
- Code access (`:836-853`): a call to an address with code size ≤ 2 that is not the sender and not in
  `precompiles` is rejected. The default config has `precompiles: []`, so any precompile call (ecrecover 0x01,
  pairing 0x08...) is rejected unless the sidecar config lists them.
- Calling `0xaa` / `EXTCODE*` on 0xaa is forbidden (`:855-865`).
- The sidecar ignores ethrex's `canonicalMempoolValid`, so a tx can pass the sidecar while ethrex
  says it is not canonical-mempool-valid.

## 10. Recent roots (EIP-8272)

- Tx field `recent_root_references` (last RLP field): list of `[source_id, slot, root]`, max 16
  (`tx.rs:2119-2150`, `docs/eip-8272.md`).
- Before any frame runs, each reference must satisfy `1 ≤ current_slot − slot ≤ 8191` and
  `RECENT_ROOT_ADDRESS[storage_key] == entry_hash`, else the tx is invalid. The mempool rejects too-new, expired and
  uncommitted references at admission.
- VERIFY reads them with `TXPARAM(0x11)` (count) and `RECENTROOTREFLOAD 0xB6` (`field` on top: 0 source_id,
  1 slot, 2 root). No storage read, so no stake needed.
- Publishing: anyone calls `0x0000000000000000000000000000000000008272` with exactly 64 bytes `salt ‖ root` and
  value 0. The predeploy stores the entry for the **current** slot under `source_id = keccak256(caller(20 bytes) ‖
  salt(32))`. One entry per (source, slot); a later write in the same slot overwrites. Cost ≈127k gas
  (`docs/eip-8272.md`). Hashes: `entry_hash = keccak(keccak("RECENT_ROOT_ENTRY") ‖ source_id ‖
  u64be(slot) ‖ root)`, `storage_key = keccak(keccak("RECENT_ROOT_STORAGE") ‖ source_id ‖ u64be(slot mod 8192))`
  (`tx.rs:2331-2362`).
- Slot = `(block_timestamp − genesis_timestamp) / seconds_per_slot` on this devnet (`derivedSlotTime` knob,
  `docs/eip-8272.md` divergence 5). Block time 6 s.
- Answer to "devnet-provided or published by someone": **published by someone**. The devnet provides no state or
  time roots. A reference's verified `slot` is itself a lower time bound (the tx lands in a slot ≥ `slot + 1`), but
  someone must pay ≈127k gas to publish in or after that slot.
  `SLOTNUM` itself is banned in VERIFY.

## 11. Stake

- Registry `NaiveStakingRegistry` at `0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f`
  (sidecar `deploy/predeploy/src/contracts/NaiveStakingRegistry.sol`):
  - `addStake(uint32 unstakeDelaySec)` payable, selector `0x0396cb60`: adds `msg.value`, sets the delay (cannot
    decrease), clears any pending withdrawal.
  - `unlockStake()` `0xbb9fe6bf`: sets `withdrawTime = now + delay`; the entity counts as unstaked immediately.
  - `withdrawStake(address payable to)` `0xc23a5cea`: after `withdrawTime`.
  - `getDepositInfo(address) returns (uint256 stake, uint32 unstakeDelaySec, uint64 withdrawTime)` `0x5287ce12`.
- Everything is keyed by `msg.sender`, so **a rule contract must call `addStake` itself** (from its SENDER frame, or from a
  normal-tx entry point in Core/owner path). Staking the deployer's EOA does nothing for the rule contract.
- Sidecar check (`ReputationService.checkStake`, config `minStake = 0.01 ETH`, `minUnstakeDelay = 0`,
  `config.ts:604-605`): staked iff `stake ≥ minStake`, `unstakeDelaySec ≥ minUnstakeDelay`, `withdrawTime == 0`,
  not banned. Read live on every validation. The BALANCE/SELFBALANCE carve-out needs `stake >
  minStake` strictly. Use 0.02 ETH and delay 86400 to be safe.
- A rule-pays Core can stake from its SENDER frame with `CALL(registry, value, addStake(86400))`. Inside VERIFY
  it cannot (static, and value calls are banned).
