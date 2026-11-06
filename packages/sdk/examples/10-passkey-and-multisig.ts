// Passkey (WebAuthn) and mixed-scheme multisig: how a rule contract's params and a trigger's witness are built. Offline: it prints the encodings.
//   bun packages/sdk/examples/10-passkey-and-multisig.ts
import { privateKeyToAccount } from "viem/accounts";
import { Scheme, buildWebAuthnAssertion, ecdsaParams, intentDigest, multisigParams, multisigWitness, p256Keygen, p256Params, signEcdsaIntent, signP256Intent, webauthnParams } from "@popcorn/sdk";

const ruleContract = "0x1111111111111111111111111111111111111111";
const binding = { chainId: 1338n, ruleContract, ruleId: 0n, ruleEpoch: 0n, triggerData: "0xdeadbeef" } as const;

// A passkey: the authenticator signs sha256(authenticatorData ++ sha256(clientDataJSON)), and clientDataJSON carries base64url(digest) as its challenge.
// In a browser, navigator.credentials.get({ publicKey: { challenge: <the 32 digest bytes>, rpId } }) returns these bytes; here a local P-256 key plays the passkey.
const passkey = p256Keygen();
const keyParams = webauthnParams({ ...passkey, rpId: "example.com", requireUV: true }); // pin the relying party and require user verification
const assertion = buildWebAuthnAssertion(passkey, intentDigest(binding), { rpId: "example.com" });
console.log("WebAuthnSigner params", keyParams.length / 2 - 1, "bytes; witness", assertion.witness.length / 2 - 1, "bytes");

// 2-of-3: an ECDSA key, a P-256 key and a second P-256 key. Signer order in the witness is by index; distinct keys; at most 16 signers.
const ecdsa = privateKeyToAccount(`0x${"01".repeat(32)}`);
const p256 = p256Keygen();
const spare = p256Keygen();
const params = multisigParams(2, [
  { scheme: Scheme.ECDSA, key: ecdsaParams(ecdsa.address) },
  { scheme: Scheme.P256, key: p256Params(p256) },
  { scheme: Scheme.P256, key: p256Params(spare) },
]);
const witness = multisigWitness(2, [
  { index: 0, sig: await signEcdsaIntent(ecdsa, binding) },
  { index: 1, sig: signP256Intent(p256, binding) },
]);
console.log("MultisigSigner params", params.length / 2 - 1, "bytes; witness", witness.length / 2 - 1, "bytes");
