---
order: 5
name: "Walkaway Exit"
problem: "Social recovery fixes lost keys, but a captured guardian majority can take the account. The owner needs a way out that works even if they can no longer sign transactions or pay gas."
modules:
  - { id: hidden-guardians, role: "Guardians can hand the account to a new key after a delay" }
  - { id: forced-exit, role: "If the owner contests the handover, anyone can send the funds to the exit address committed on day one" }
  - { id: rule-pays, role: "The account pays for the exit; the person who sends it holds no ETH" }
featured: "the forced exit, sent by a key with no ETH"
---
Contested control never ends with the attacker holding the money: the funds walk away to the owner's own safe address.
