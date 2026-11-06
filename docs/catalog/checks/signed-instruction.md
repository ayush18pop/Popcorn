---
name: "Signed Instruction, Anyone Can Send"
shape: check
tier: 1
status: built
runsOn: [public, alternative]
gas: null
inputs:
  - { name: "signer", what: "the key type: ECDSA, passkey (P-256, WebAuthn), both keys must sign, k of n keys, or a post-quantum scheme (WOTS+, FORS, XMSS-style, SPHINCS+-style, Falcon)" }
  - { name: "key", what: "the signer's params: the public key or keys" }
perTrigger: "the instruction (trigger data) and the signature (verify data)"
output: "yes / no / unknown"
presets: ["Wallet spend (Sovereign Account)", "Passkey wallet", "Treasury with k of n keys", "Post-quantum key"]
sdk: "blocks.signedInstruction"
related: [make-a-call, statement-signed-by-reporters, switch-to-quantum-safe-only]
code: ["contracts/src/blocks/checks/SignedInstruction.sol"]
---

# Signed Instruction, Anyone Can Send

## What it does

Yes when a key signed this exact instruction for this build. Anyone can then deliver it, from a wallet with no ETH, and nobody can change what was signed: the instruction is inside the signed digest, and each signature works once.

## Inputs

- **signer**: the key type: ECDSA, passkey (P-256, WebAuthn), both keys must sign, k of n keys, or a post-quantum scheme (WOTS+, FORS, XMSS-style, SPHINCS+-style, Falcon)
- **key**: the signer's params: the public key or keys
- **each trigger brings**: the instruction (trigger data) and the signature (verify data)
- **answers**: yes / no / unknown

## Presets

- Wallet spend (Sovereign Account)
- Passkey wallet
- Treasury with k of n keys
- Post-quantum key

## Code

```ts
const signature = await signEcdsaIntent(owner, { chainId, ruleContract, ruleId: 0n, ruleEpoch: 0n, triggerData });
const hash = await anyone.trigger(ruleContract, { triggerData, verifyData: signature });
```

```solidity
function nonceKey(bytes calldata) internal view override returns (uint256) { return _instructionKey(0); }
function condition(bytes calldata data, bytes calldata sig) internal view override returns (bool) {
    return _signedInstruction(address(ecdsaSigner), abi.encodePacked(owner), 0, data, sig).isYes();
}
function action(bytes calldata data, address) internal override {
    _useInstruction(0); // first: the signature can never match again
    (address to, uint256 value) = abi.decode(data, (address, uint256));
    _makeCall(to, value, "");
}
```

## Runs on

With the key inline (ECDSA, WOTS+) a trigger fits the public mempool. Heavier schemes, such as Falcon (about 1.5M gas), need the alternative mempool's staked budget.

## Limits

- Replay protection lives in the build's epoch, not in the signature.
- A signature's no only means the signature failed, so this block cannot sit under None Of or Exactly One Of.
