---
name: "Stealth Address"
group: private
trigger: proof
status: built
runsOn: [alternative-staked]
gas: { total: 460359, tag: measured, network: local }
example: examples/private/private-payroll/run.json
related: [private-pool, pool-pays]
properties: [private, post-quantum-announcement]
code: ["contracts/src/privacy/StealthVault.sol", "packages/zk/circuits/stealth.circom", "packages/sdk/src/privacy.ts"]
---

# Stealth Address

## What it does

Pay someone at an address nobody can link to them, and let them spend it without first funding it with ETH, which would link it back. The announcement uses ML-KEM-768, so recording it today does not reveal the receiver to a future quantum computer.

## When it fires

When a spend carries a proof of the receiver's spend secret behind the stealth commitment, for this recipient and fee.

## What it does then

Sends the payment minus the fee to the recipient; the vault pays the gas. Each commitment is spent once, enforced by its nonce key.

## Runs on

The proof check calls a verifier contract, so the vault stakes: the alternative mempool.

## Code

```ts
const payment = await prepareStealthPayment(receiverMetaAddress, stealthCommitment); // ML-KEM encapsulation
await stealthPay(clients, vault, payment, parseEther("1"));
const [mine] = await scanStealth(keys, await stealthAnnouncements(pub, vault), stealthCommitment);
const p = await stealthProof({ spendSecret, shared: mine.shared, recipient: BigInt(to), fee });
await anyone.trigger(vault, stealthSpend({ commitment: mine.commitment, recipient: to, fee, proof: p.proof }));
```

## Limits

- The payer knows the shared secret but not the spend secret, so it can recognise the payment but never take it back.
- The spend proof is Groth16: zero-knowledge, not post-quantum.
