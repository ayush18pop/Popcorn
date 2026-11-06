pragma circom 2.2.3;

include "../../node_modules/circomlib/circuits/bitify.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";

// Widths (VAULT_SPEC.md §2): T, S, h, a < 2^120; M < 2^88; addresses 160 bits; claim id 64 bits.
// All products stay below 2^241, far below the BN254 scalar field (~2^253.6): no wraparound.

// x < 2^n, returns nothing (constraint only).
template Range(n) {
    signal input in;
    component b = Num2Bits(n);
    b.in <== in;
}

