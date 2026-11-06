---
order: 6
name: "Sovereign Account"
flagship: true
problem: "A wallet depends on things that can fail: a signature scheme, guardians, a relayer, a gas balance. Each failure today means lost funds or lost privacy."
modules:
  - { id: stealth-vault, role: "Receives to an ML-KEM stealth meta-address and sweeps in without a gas top-up (a ready-made build)" }
  - { id: private-pool, role: "Holds the balance privately (a ready-made build)" }
  - { id: signed-instruction, role: "The owner signs each spend with ECDSA and Falcon-512 over the same digest (both keys must sign); any key can send it" }
  - { id: make-a-call, role: "The spend itself: any call, with any value" }
  - { id: anonymous-group-vote, role: "Unnamed guardians recover the account or flip the quantum switch" }
  - { id: hand-over-to-a-new-key, role: "A guardian recovery waits a delay and can be contested by the owner" }
  - { id: switch-to-quantum-safe-only, role: "After the switch only the committed post-quantum backup key can move the funds" }
  - { id: exit-to-an-address, role: "A contested takeover sends everything to the committed exit address; the backup key migrates" }
  - { id: contract-pays-the-gas, role: "The account pays its own gas, so a key with no ETH can send its transactions" }
build: contracts/src/builds/SovereignAccount.sol
featured: "an owner spend sent by a key with no ETH"
---
One account that passes every CROPS property at once, assembled from modules that each ship and are tested on their own.
