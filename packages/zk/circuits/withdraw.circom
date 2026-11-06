pragma circom 2.2.3;

// Private pool withdrawal with an association set.
//
// A deposit is a commitment Poseidon(nullifier, secret) inserted into the pool's tree. To withdraw, the owner proves:
//   1. the commitment is in the pool tree (root),
//   2. the commitment is in the association set (assocRoot): a tree of deposits an association-set provider has
//      accepted, so the withdrawal shows it does not come from a flagged deposit, without saying which deposit it is,
//   3. nullifierHash = Poseidon(nullifier, scope), spent once (the pool uses it as the transaction's nonce key),
//   4. recipient and fee are the ones the pool will use (bound, so nobody can redirect the funds or raise the fee).
// scope is the pool's own address, so a note of one pool can never be spent in another.

include "../node_modules/circomlib/circuits/poseidon.circom";
include "lib/merkle.circom";

template Withdraw(levels) {
    signal input root;
    signal input assocRoot;
    signal input nullifierHash;
    signal input recipient;
    signal input fee;
    signal input scope;

    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal input assocPathElements[levels];
    signal input assocPathIndices[levels];

    component commitment = Poseidon(2);
    commitment.inputs[0] <== nullifier;
    commitment.inputs[1] <== secret;

    component pool = MerkleRoot(levels);
    pool.leaf <== commitment.out;
    component assoc = MerkleRoot(levels);
    assoc.leaf <== commitment.out;
    for (var i = 0; i < levels; i++) {
        pool.pathElements[i] <== pathElements[i];
        pool.pathIndices[i] <== pathIndices[i];
        assoc.pathElements[i] <== assocPathElements[i];
        assoc.pathIndices[i] <== assocPathIndices[i];
    }
    root === pool.root;
    assocRoot === assoc.root;

    component nul = Poseidon(2);
    nul.inputs[0] <== nullifier;
    nul.inputs[1] <== scope;
    nullifierHash === nul.out;

    signal recipientSquare;
    recipientSquare <== recipient * recipient;
    signal feeSquare;
    feeSquare <== fee * fee;
}

component main {public [root, assocRoot, nullifierHash, recipient, fee, scope]} = Withdraw(20);
