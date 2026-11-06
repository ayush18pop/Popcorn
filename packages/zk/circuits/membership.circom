pragma circom 2.2.3;

// Private membership: "I am one of the members of this set", without saying which one.
//
// Public:  root              the set (a Poseidon Merkle root the verifying contract keeps in its own storage)
//          nullifierHash     Poseidon(secret, externalNullifier): one per member per scope, so a member acts once
//          signalHash        what the member approves (an account to sponsor, a new owner, a vote), bound to the proof
//          externalNullifier the scope (a sponsor, a recovery round, a ballot), chosen by the verifying contract
// Private: secret, and the path of the member's leaf Poseidon(secret) in the tree.
//
// Used by: the Open Sponsor's membership gate, hidden-guardian recovery, anonymous votes.

include "../node_modules/circomlib/circuits/poseidon.circom";
include "lib/merkle.circom";

template Membership(levels) {
    signal input root;
    signal input nullifierHash;
    signal input signalHash;
    signal input externalNullifier;

    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component leaf = Poseidon(1);
    leaf.inputs[0] <== secret;

    component tree = MerkleRoot(levels);
    tree.leaf <== leaf.out;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    root === tree.root;

    component nul = Poseidon(2);
    nul.inputs[0] <== secret;
    nul.inputs[1] <== externalNullifier;
    nullifierHash === nul.out;

    // bind the signal: a proof for one signal does not verify for another
    signal signalSquare;
    signalSquare <== signalHash * signalHash;
}

component main {public [root, nullifierHash, signalHash, externalNullifier]} = Membership(20);
