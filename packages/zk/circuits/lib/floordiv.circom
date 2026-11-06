pragma circom 2.2.3;

// Honest prover hints. The constraints are what matter; test/evil/ swaps only the <-- hints and checks
// that the R1CS is byte-identical.
// floor(num / den) for num < 2^nNum, den < 2^nDen, den > 0 (den > rem >= 0 forces den > 0).
// quotient < 2^nQ.
template FloorDiv(nQ, nDen) {
    signal input num;
    signal input den;
    signal output q;
    signal rem;

    q <-- num \ den;
    rem <-- num % den;
    num === q * den + rem;

    component rq = Range(nQ);
    rq.in <== q;
    component rr = Range(nDen);
    rr.in <== rem;
    component lt = LessThan(nDen);
    lt.in[0] <== rem;
    lt.in[1] <== den;
    lt.out === 1;
}

