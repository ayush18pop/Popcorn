pragma circom 2.2.3;

// Spending a stealth payment.
//
// The receiver publishes an ML-KEM public key and a spending tag T = Poseidon(spendSecret). A payer encapsulates to the
// ML-KEM key, gets a shared secret s, and pays into the stealth vault under the commitment C = Poseidon(T, s), with the
// ML-KEM ciphertext as the announcement. Only the receiver can decapsulate s, so only the receiver recognises C; the
// payer knows s but not spendSecret, so the payer cannot take the payment back.
//
// To spend, the receiver proves knowledge of (spendSecret, s) with C = Poseidon(Poseidon(spendSecret), s), bound to
// the recipient and the fee. Nothing on chain links C to T or to other payments to the same receiver.
//
// The announcement is post-quantum (ML-KEM): recording it today does not reveal the receiver to a future quantum
// computer. The spend proof is Groth16, which is zero-knowledge but not post-quantum.

include "../node_modules/circomlib/circuits/poseidon.circom";

template StealthSpend() {
    signal input commitment;
    signal input recipient;
    signal input fee;

    signal input spendSecret;
    signal input shared;

    component tag = Poseidon(1);
    tag.inputs[0] <== spendSecret;
    component c = Poseidon(2);
    c.inputs[0] <== tag.out;
    c.inputs[1] <== shared;
    commitment === c.out;

    signal recipientSquare;
    recipientSquare <== recipient * recipient;
    signal feeSquare;
    feeSquare <== fee * fee;
}

component main {public [commitment, recipient, fee]} = StealthSpend();
