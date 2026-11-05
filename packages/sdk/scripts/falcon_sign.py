#!/usr/bin/env python3
"""Falcon-512 (ETHFALCON, keccak hash-to-point) key generation and signing for Popcorn's tests, on top of the vendored ZKNox python reference
(packages/sdk/vendor/ethfalcon-python, MIT). JSON in on stdin, JSON out on stdout.

  falcon_sign.py keygen                      -> {"sk": {f,g,F,G}, "pk": [32 hex words]}        (pk = NTT-domain public key, compacted: 16 x 16 bits per word)
  falcon_sign.py sign   {"sk": {...}, "msg": "0x.."} -> {"salt": "0x" (40 bytes), "s2": [32 hex words]}   (s2 compacted the same way)

Run with `python3 -I` from a python that has numpy, pycryptodome and polyntt (see the vendor README). Experimental upstream code: tests and demos only.
"""
import json
import os
import sys

sys.dont_write_bytecode = True  # do not leave __pycache__ in the vendored directory
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vendor", "ethfalcon-python"))

from common import falcon_compact, q  # noqa: E402
from encoding import decompress  # noqa: E402
from falcon import HEAD_LEN, SALT_LEN, PublicKey, SecretKey  # noqa: E402
from keccak_prng import KeccakPRNG  # noqa: E402
from polyntt.poly import Poly  # noqa: E402


def word(w):
    return "0x%064x" % int(w)  # hex strings: a JSON number would lose precision in JavaScript


def keygen():
    sk = SecretKey(512)
    pk = PublicKey(512, sk.h)
    return {"sk": {"f": sk.f, "g": sk.g, "F": sk.F, "G": sk.G}, "pk": [word(w) for w in falcon_compact(Poly(pk.pk, q).ntt())]}


def sign(req):
    k = req["sk"]
    sk = SecretKey(512, polys=[k["f"], k["g"], k["F"], k["G"]])
    pk = PublicKey(512, sk.h)
    msg = bytes.fromhex(req["msg"][2:])
    sig = sk.sign(msg, xof=KeccakPRNG)
    assert pk.verify(msg, sig, xof=KeccakPRNG), "self-check failed"
    salt = sig[HEAD_LEN:HEAD_LEN + SALT_LEN]
    s2 = [e % q for e in decompress(sig[HEAD_LEN + SALT_LEN:], pk.sig_bytelen - HEAD_LEN - SALT_LEN, 512)]
    return {"salt": "0x" + salt.hex(), "s2": [word(w) for w in falcon_compact(s2)]}


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "keygen":
        print(json.dumps(keygen()))
    elif cmd == "sign":
        print(json.dumps(sign(json.loads(sys.stdin.read()))))
    else:
        sys.exit("usage: falcon_sign.py keygen | sign")
