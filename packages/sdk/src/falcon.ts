// Falcon-512 with the ETHFALCON keccak hash-to-point (ZKNox, MIT): on-chain verifier vendored in contracts/src/signers/vendor/ethfalcon, signer wrapped from
// ZKNox's python reference (packages/sdk/vendor/ethfalcon-python, run by scripts/falcon_sign.py). The python is experimental upstream code: tests and demos only.
// Needs python3 with numpy, pycryptodome and polyntt; point POPCORN_FALCON_PYTHON at it (default "python3").
//   params  = the public key in the NTT domain, 32 words of 16 coefficients x 16 bits (1,024 bytes)
//   witness = salt (40 bytes) ++ s2 (32 words, same packing) = 1,064 bytes; the signed message is the 32-byte intent digest
// Stateless and many-time: no epoch binding is needed (the digest already binds the epoch).
import { execFileSync } from "node:child_process";
import { concat, toHex, type Hex } from "viem";
import { IntentError, intentDigest, type IntentBinding } from "./intent.ts";

export const FALCON_PARAMS_BYTES = 1024;
export const FALCON_WITNESS_BYTES = 40 + 1024;
const SCRIPT = new URL("../scripts/falcon_sign.py", import.meta.url).pathname;

export interface FalconKey {
  /** Secret polynomials (f, g, F, G). Treat like a private key. */
  sk: { f: number[]; g: number[]; F: number[]; G: number[] };
  /** FalconSigner params: the NTT-domain public key, 1,024 bytes. */
  params: Hex;
}

const run = (args: string[], input?: string): unknown => {
  try {
    const out = execFileSync(process.env.POPCORN_FALCON_PYTHON ?? "python3", ["-I", SCRIPT, ...args], { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
    return JSON.parse(out);
  } catch (e) {
    throw new IntentError(`falcon signer failed (needs python3 with numpy, pycryptodome and polyntt; set POPCORN_FALCON_PYTHON): ${(e as Error).message.split("\n")[0]}`);
  }
};
const words = (w: (number | string)[]): Hex => concat(w.map((x) => toHex(BigInt(x), { size: 32 })));

/** Generates a Falcon-512 key (about 5 s in the python reference). */
export function falconKeygen(): FalconKey {
  const r = run(["keygen"]) as { sk: FalconKey["sk"]; pk: (number | string)[] };
  return { sk: r.sk, params: words(r.pk) };
}
/** Signs a 32-byte digest: salt ++ s2 (1,064 bytes). */
export function falconSignDigest(key: FalconKey, digest: Hex): Hex {
  const r = run(["sign"], JSON.stringify({ sk: key.sk, msg: digest })) as { salt: Hex; s2: (number | string)[] };
  return concat([r.salt, words(r.s2)]);
}
export const falconIntentSigner = (key: FalconKey) => ({ params: key.params, signDigest: (d: Hex) => falconSignDigest(key, d), sign: (b: IntentBinding) => falconSignDigest(key, intentDigest(b)) });
