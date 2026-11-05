# Guarded vault and proof of exploit: specification

`GuardedVault` is an example vault that protects itself. It has two profiles built from one logic:

- **pause-only:** the vault pauses itself when its safety invariant breaks, triggered by anyone, even a wallet with 0 ETH.
- **bounty:** a whitehat proves in zero knowledge that the vault's bug can break the invariant, gets paid, and the
  vault pauses, in one transaction.

The vault deliberately contains a bug (§3) so the bounty has something to prove. The proof-of-exploit circuit encodes
§3 to §5 exactly; if a formula here changes, the circuit must change too.

All values are unsigned integers. `/` is integer division rounding down (Solidity semantics);
`ceil(x / y) = (x + y - 1) / y`. WAD = 10^18.

## 1. State

| Symbol | Name | Type | Meaning |
|---|---|---|---|
| T | `totalAssets` | uint120 | assets the vault accounts for (a storage variable, not `balanceOf`, so donations do not count) |
| S | `totalSupply` | uint120 | shares outstanding |
| M | `minAssetsPerShare` | uint88 | invariant floor, WAD-scaled (1e18 = one asset per share) |
| `balanceOf[a]` | shares of `a` | uint256 (≤ S) | |
| `paused` | | bool | set by the rule contract's action; blocks deposit/withdraw/redeem |
| `pauseEpoch` | | uint64 | bumped on each pause; the pause nonce key is `hash("pause", pauseEpoch)` |

Bounds: T, S < 2^120 (`uint120` makes any overflow revert; 2^120 ≈ 1.3e36 = 1.3e18 whole tokens at 18 decimals);
M < 2^88. The circuit range-checks the same widths, so every reachable state is provable.

## 2. Safety invariant

```
SAFE  ⇔  T * 1e18 >= S * M
```

Written without division, so the pause condition is exactly `T * 1e18 < S * M`, with no rounding. Both sides are
< 2^209. Correct ERC-4626 rounding (deposit and redeem round down for the user, withdraw rounds the burned shares up)
never lowers assets per share, so with correct code a SAFE vault stays SAFE. The example uses M = 1e18: a share must
never be worth less than the one asset it was minted for.

## 3. Operations (exact integer formulas)

```
deposit(a)        require !paused, a > 0
                  shares = (S == 0) ? a : a * S / T                     // rounds down: correct
                  T += a; S += shares; balanceOf[msg.sender] += shares  // pulls a of `asset`

redeem(shares)    require !paused, shares <= balanceOf[owner]
                  a = shares * T / S                                   // rounds down: correct
                  T -= a; S -= shares; balanceOf[owner] -= shares      // sends a

maxWithdraw(o)    = balanceOf[o] * T / S                               // rounds down: correct

withdraw(a)       require !paused, a <= maxWithdraw(owner)
                  rate   = S / T                                       // BUG (see below)
                  shares = a * rate
                  require shares <= balanceOf[owner]
                  T -= a; S -= shares; balanceOf[owner] -= shares      // sends a

harvest(y)        onlyOwner: T += y                                    // yield, pulls y of `asset`
```

**The bug: division before multiplication in `withdraw`.** The correct burn is `shares = ceil(a * S / T)`. The vault
computes the "shares per asset" rate first, `S / T`, which truncates:

- At launch the vault is 1:1 (T == S), `S / T = 1` and `withdraw` is exactly right. Unit tests and a deposit/withdraw
  fuzz at 1:1 pass.
- After the first `harvest`, T > S, so `S / T = 0` and **every withdraw burns 0 shares**. A holder can withdraw
  `maxWithdraw` again and again, keeping their shares, until the price falls below 1.
- Once T < S, `S / T` is ≥ 1 but still truncated (for example S/T = 1.18 → 1), so each withdraw keeps burning too few
  shares: a holder gets one asset per share while a share is worth less than one.

It is the classic "precision loss from division before multiplication" finding, latent until the vault earns yield.
`deposit` / `redeem` are correct, so normal users (who redeem) never trigger it by accident.

## 4. Storage layout (ERC-7201)

The state lives in one namespaced struct so it cannot collide with anything Core or `RuleContract` stores.
Base = `keccak256(abi.encode(uint256(keccak256("popcorn.vault.demo")) - 1)) & ~bytes32(uint256(0xff))`.

```
base = 0xe18b2d7ee7ce8700b82e0064e8a5a42e72025ee9bea0e34c50fbf75a6f8fbb00
```

| Slot | Contents (bit ranges, little end = 0) |
|---|---|
| base + 0 = `…fbb00` | `totalAssets` uint120 [0..119], `totalSupply` uint120 [120..239], `paused` bool [240..247] |
| base + 1 = `…fbb01` | `minAssetsPerShare` uint88 [0..87], `pauseEpoch` uint64 [88..151] |
| base + 2 = `…fbb02` | `asset` address |
| base + 3 = `…fbb03` | `owner` address |
| base + 4 = `…fbb04` | `balanceOf` mapping; balance of `a` at `keccak256(abi.encode(a, base + 4))` |

Solidity: `src/proofs/VaultLayout.sol` (`struct VaultState` with
`@custom:storage-location erc7201:popcorn.vault.demo`; the struct packs exactly as in the table).

## 5. Public inputs of the proof (what the rule contract compares with its storage)

Three BN254 field elements, in this order:

| # | Name | Value | Rule contract source |
|---|---|---|---|
| 0 | `state` | `T + S * 2^120` (240 bits) | `sload(base) & (2^240 - 1)`; **refused (reverts) if the `paused` bit is set** |
| 1 | `claim` | `recipient + claimId * 2^160` (224 bits) | popArgs: `(address recipient, uint64 claimId)` |
| 2 | `domain` | `vault + M * 2^160` (248 bits) | `address(this)` and `sload(base + 1) & (2^88 - 1)` |

`ExploitInputs.fromStorage(recipient, claimId)` does this with two SLOADs; `ExploitInputs.pack(...)` takes the values
directly (and reverts if one is out of range). Because the layout in §4 matches the packing, the rule contract never
unpacks: it hands its own storage words to the verifier. A proof therefore verifies only for this vault address, this
exact (T, S, M), this recipient and this claim id. Once the state changes (any deposit or withdraw), an old proof stops
verifying.

**Replay rules.** Paying and pausing does not change (T, S, M), and the claimant picks the claimId, so the proof alone
cannot stop a second claim. Two rules do:

1. `fromStorage` reverts with `VaultPaused` when the paused bit is set. In VERIFY a revert makes the transaction
   invalid, so no claim (any claimId, any proof) is admitted while the vault is paused.
2. The nonce key is **one per pause epoch, not per claimId**: `keccak256(abi.encode("bounty", address(this),
   pauseEpoch))` (`ExploitInputs.bountyNonceKey()`). The action pays, sets `paused` and increments `pauseEpoch`.
   Competing claims in one epoch share one key, so Core's nonce sequence admits only one.

After the owner unpauses, a new epoch opens. The owner must fix the bug or change the state before unpausing, or the
same exploit can be claimed again. If the pause-only rule fires first, no bounty can be claimed in that epoch: the
bounty is for proving before the invariant is broken on chain.

**Fragility.** Because `inputs[0]` is the live `(T, S)`, any state change, even a 1-wei deposit by anyone, makes every
pending bounty claim invalid (the proof no longer verifies). Re-proving from the new state takes under a second, but a
griefer can keep a claim out cheaply on a busy vault. A stronger design proves against a per-epoch snapshot word
(written by `harvest` / `unpause` / a rate-limited `checkpoint`) instead of the live state.

Statement proved (private: holding `h`, amounts `a[0..2]`): starting from (T, S) with `T*1e18 >= S*M` and `h <= S`,
three calls of §3's `withdraw` by a holder of `h` shares, each with `a[i] <= maxWithdraw` and `shares <= h`
(a[i] = 0 allowed), end in a state with `T3 * 1e18 < S3 * M`.

## 6. Worked example (`test/fixtures/zk-valid.json`)

Deposits of 1,000 assets at 1:1, then `harvest(100)`: T = 1,100e18, S = 1,000e18, M = 1e18 (price 1.1, SAFE). The
attacker holds h = 200e18 shares (deposited 200 before the harvest; their fair claim is 220 assets).

| Step | maxWithdraw | a (withdrawn) | rate = S / T | shares burned (correct: ceil(a*S/T)) | T after | S after | h after | assets/share | SAFE |
|---|---|---|---|---|---|---|---|---|---|
| start | | | | | 1,100e18 | 1,000e18 | 200e18 | 1.100 | yes |
| 1 | 220e18 | 220e18 | 1000/1100 = **0** | **0** (200e18) | 880e18 | 1,000e18 | 200e18 | 0.880 | **no** |
| 2 | 176e18 | 176e18 | 1000/880 = **1** | 176e18 (200e18) | 704e18 | 824e18 | 24e18 | 0.854 | no |
| 3 | 20.504854368932038834e18 | same | 824/704 = **1** | 20.504854368932038834e18 (24e18 − 1) | 683.495145631067961166e18 | 803.495145631067961166e18 | 3.495145631067961166e18 | 0.851 | no |

Exact integers (wei): step 3 `a = 24e18 * 704e18 / 824e18 = 20504854368932038834`, end state T = 683495145631067961166,
S = 803495145631067961166. The attacker has taken 416.50e18 assets and still holds 3.50e18 shares, against a fair
220e18: about 200e18 assets taken from the other depositors in three transactions. The invariant breaks at step 1, so
the pause-only rule can fire after the first attack transaction, and steps 2 and 3 then revert (`paused`).

Smaller variants: while T > S, any holder with `h * T / S > T - S * M / 1e18` breaks the invariant in one withdraw; a
0.1% holder (h = 1e18) cannot break it in three calls.

## 7. What the proof guarantees, and what it does not

The proof guarantees two things:
- the payout goes only to the recipient bound in the proof (a copied or replaced transaction with another recipient is
  invalid);
- no exploit recipe (holding, amounts) is revealed in the mempool.

It does **not** reward the discoverer. For this example bug, whether an exploit exists can be read from public state:
once T > S, anyone can prove it with `h = S, a = [S, 0, 0]`. The bounty is therefore "first valid claim wins". In a
real deployment the statement would be a zkVM proof over the real vault bytecode, where finding the inputs is the hard
part. Commit-reveal (claim a hash first, reveal the proof later) would give the discoverer priority; it is not built.

Groth16 is zero-knowledge but **not post-quantum**: it relies on pairings, which a quantum computer could break.

## 8. Conformance

The circuit proves facts about the formulas in §3, not about deployed bytecode. If `GuardedVault` drifts from §3
(rounding, order of updates, the cap), proofs stop meaning anything about the real vault. `test/GuardedVault.t.sol`
deploys the vault in the worked-example state (§6), replays the fixture's `steps` (withdraws by a holder of 200e18
shares) against the real contract, and requires identical (T, S, h) after every step, plus `maxWithdraw` and shares
burned per step. Optional hardening: the bounty rule contract pins the vault logic's `extcodehash` that passed the
conformance test.
