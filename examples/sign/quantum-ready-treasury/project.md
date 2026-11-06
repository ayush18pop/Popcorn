---
order: 4
name: "Quantum-Ready Treasury"
problem: "When ECDSA breaks, every account whose public key is on chain can be drained, and adding a post-quantum key at that point is too late: the attacker can add one too."
modules:
  - { id: signature, role: "Day to day the owner's ECDSA key signs each spend; after the switch only the committed WOTS+ backup key signs" }
  - { id: anonymous-vote, role: "Guardians, unnamed, can flip the switch if the owner cannot" }
  - { id: post-quantum-mode, role: "Once flipped, owner signatures stop working" }
  - { id: withdraw-all, role: "Migrate: the backup key moves everything to a post-quantum account, once" }
  - { id: self-paying, role: "The treasury pays its own gas, so any key can send its transactions" }
build: contracts/src/builds/SovereignAccount.sol
featured: "the migration signed by the post-quantum backup key"
---
A DAO treasury that keeps working through a quantum break: one switch, and only the key nobody has seen can move the money.
