---
name: "Quantum-Ready Treasury"
problem: "When ECDSA breaks, every account whose public key is on chain can be drained, and adding a post-quantum key at that point is too late: the attacker can add one too."
modules:
  - { id: hybrid-owner-key, role: "Day to day the owner signs; the account commits to a hidden post-quantum backup key" }
  - { id: hidden-guardians, role: "Guardians, unnamed, can flip the quantum switch if the owner cannot" }
  - { id: quantum-switch, role: "Once flipped, owner signatures stop working" }
  - { id: post-quantum-signer, role: "The committed WOTS+ backup key moves everything to a post-quantum account, once" }
featured: "the migration signed by the post-quantum backup key"
---
A DAO treasury that keeps working through a quantum break: one switch, and only the key nobody has seen can move the money.
