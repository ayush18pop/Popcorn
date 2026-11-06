pragma circom 2.2.3;

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/mux1.circom";

// Root of a binary Poseidon Merkle tree of depth `levels` from a leaf and its path.
// pathIndices[i] = 0 when the running node is the left child at level i, 1 when it is the right child.
// Each index is constrained to a bit, so a prover cannot pick a field value that mixes both children.
template MerkleRoot(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;

    component hashers[levels];
    component left[levels];
    component right[levels];
    signal node[levels + 1];
    node[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;
        left[i] = Mux1();
        left[i].c[0] <== node[i];
        left[i].c[1] <== pathElements[i];
        left[i].s <== pathIndices[i];
        right[i] = Mux1();
        right[i].c[0] <== pathElements[i];
        right[i].c[1] <== node[i];
        right[i].s <== pathIndices[i];
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i].out;
        hashers[i].inputs[1] <== right[i].out;
        node[i + 1] <== hashers[i].out;
    }
    root <== node[levels];
}
