# Vendored: ETHFALCON (ZKNox)

Source: https://github.com/ZKNoxHQ/ETHFALCON, commit `43ac863` (main, 2026), `src/`, copied unchanged (file names, code and headers):
`ZKNOX_common.sol`, `ZKNOX_falcon_utils.sol`, `ZKNOX_NTT_falcon.sol`, `ZKNOX_falcon_core.sol`, `ZKNOX_HashToPoint.sol`, `ZKNOX_shake.sol`.
License: MIT, Copyright (c) 2025 ZKNOX (`LICENSE.txt`, kept next to the code). Authors of the Falcon verifier: Renaud Dubois, Simon Masson (ZKNox).
Not audited by its authors ("experimental work, DO NOT USE IN PRODUCTION"); Popcorn's use is a measured research integration, see docs/phase-t2-report.md.

What is used: `hashToPointEVM` (Keccak-CTR hash-to-point, the "ETH" part of ETHFALCON) and `falcon_core` (NTT-domain Falcon-512 verification with the
compacted encodings). Everything else in the ETHFALCON repository (epervier, the NIST SHAKE variant, the SSTORE2 public-key contract) is not vendored.
