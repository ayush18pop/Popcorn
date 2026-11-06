---
order: 6
name: "Sovereign Account"
flagship: true
problem: "A wallet depends on things that can fail: a signature scheme, guardians, a relayer, a gas balance. Each failure today means lost funds or lost privacy."
modules:
  - { id: stealth-addresses, role: "Receives to an ML-KEM stealth meta-address and sweeps in without a gas top-up (a complete contract)" }
  - { id: privacy-pool, role: "Holds the balance privately (a complete contract)" }
  - { id: signature, role: "The owner signs each spend with ECDSA and Falcon-512 over the same digest (a hybrid signer: both keys must sign); any key can send it" }
  - { id: call, role: "The spend itself: any call, with any value" }
  - { id: anonymous-vote, role: "Unnamed guardians recover the account or flip the quantum switch" }
  - { id: key-rotation, role: "A guardian recovery waits a delay and can be contested by the owner" }
  - { id: post-quantum-mode, role: "After the switch only the committed post-quantum backup key can move the funds" }
  - { id: withdraw-all, role: "A contested takeover sends everything to the committed exit address; the backup key migrates" }
  - { id: self-paying, role: "The account pays its own gas, so a key with no ETH can send its transactions" }
build: contracts/src/builds/SovereignAccount.sol
featured: "an owner spend sent by a key with no ETH"
---
One account that passes every CROPS property at once, assembled from modules that each ship and are tested on their own.
