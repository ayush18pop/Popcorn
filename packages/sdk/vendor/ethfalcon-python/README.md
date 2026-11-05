# Vendored: ETHFALCON python reference signer (ZKNox)

Source: https://github.com/ZKNoxHQ/ETHFALCON `pythonref/` (commit `43ac863`), the import closure of `falcon.py`, copied unchanged. The code is MIT
(`LICENSE`: Copyright (c) 2018 Thomas Prest; adaptations by Renaud Dubois and Simon Masson, ZKNox). "Experimental code, not the reference code of Falcon,
not considered secure or suitable for production" (their words): Popcorn uses it only to generate Falcon-512 keys and signatures for tests and demos.
Needs python3 with `numpy`, `pycryptodome` and `polyntt` (`pip install numpy pycryptodome "git+https://github.com/ZKNoxHQ/NTT.git@main#egg=polyntt&subdirectory=assets/pythonref/"`);
`packages/sdk/scripts/falcon_sign.py` is Popcorn's small CLI around it, `packages/sdk/src/falcon.ts` the TypeScript wrapper.
