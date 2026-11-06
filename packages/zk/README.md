# @popcorn/zk

Circuits, keys and proving helpers for the zero-knowledge modules. Groth16 over BN254: zero-knowledge, not post-quantum.

| Circuit | Statement | Public inputs | Used by |
|---|---|---|---|
| `membership` | I am one of the members of this set; one nullifier per member per scope | root, nullifierHash, signalHash, externalNullifier | Open Sponsor gate, hidden-guardian recovery, anonymous votes |
| `withdraw` | My deposit is in the pool and in an association set; recipient and fee bound | root, assocRoot, nullifierHash, recipient, fee, scope | Private pool |
| `stealth` | I know the spend secret behind this stealth commitment; recipient and fee bound | commitment, recipient, fee | Stealth address |
| `exploit` | This vault can be broken (the existing proof of exploit) | state, claim, domain | Proof-of-exploit bounty |

```sh
bun install                 # from the repo root
bun run build               # circom -> build/<circuit>.r1cs and .wasm
bun run setup               # development trusted setup (scripts/setup.sh), skips keys that exist
bun run gen-verifiers       # contracts/src/proofs/<Name>Verifier.sol from setup/<circuit>_vkey.json
bun scripts/gen-zeros.ts    # contracts/src/privacy/PoseidonZeros.sol
bun scripts/gen-fixtures.ts # contracts/test/fixtures/zk-modules.json (Forge tests)
bun test test/              # proofs verify; tampered inputs do not
```

The keys in `setup/` come from a development phase 2 on top of the public Hermez powers of tau: whoever made the phase 2
contribution could forge proofs. They are for the devnets; a production deployment needs a multi-party ceremony.
