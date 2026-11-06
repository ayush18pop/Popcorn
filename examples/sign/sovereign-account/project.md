---
name: "Sovereign Account"
flagship: true
problem: "A wallet depends on things that can fail: a signature scheme, guardians, a relayer, a gas balance. Each failure today means lost funds or lost privacy."
modules:
  - { id: stealth-address, role: "Receives to an ML-KEM stealth meta-address and sweeps in without a gas top-up" }
  - { id: private-pool, role: "Holds the balance privately" }
  - { id: signed-intent, role: "The owner signs each spend; the account pays its own gas, so any key can send it" }
  - { id: hybrid-owner-key, role: "The flagship owner is ECDSA and Falcon-512 over the same digest" }
  - { id: hidden-guardians, role: "Unnamed guardians recover the account or flip the quantum switch" }
  - { id: quantum-switch, role: "After the switch only the committed post-quantum backup key can move the funds" }
  - { id: forced-exit, role: "A contested takeover sends everything to the committed exit address" }
featured: "an owner spend sent by a key with no ETH"
---
One account that passes every CROPS property at once, assembled from modules that each ship and are tested on their own.
