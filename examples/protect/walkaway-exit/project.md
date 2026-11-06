---
order: 5
name: "Walkaway Exit"
problem: "Social recovery fixes lost keys, but a captured guardian majority can take the account. The owner needs a way out that works even if they can no longer sign transactions or pay gas."
modules:
  - { id: anonymous-vote, role: "Guardians, unnamed, vote to hand the account to a new key" }
  - { id: key-rotation, role: "The handover waits out a delay in which the owner can contest it" }
  - { id: signature, role: "The owner's contest is a signature over the vote round: no ETH, no transaction of their own needed" }
  - { id: withdraw-all, role: "Once contested, anyone sends everything to the exit address committed on day one" }
  - { id: self-paying, role: "The account pays for the votes and the exit; the person who sends the exit holds no ETH" }
build: contracts/src/builds/SovereignAccount.sol
featured: "the forced exit, sent by a key with no ETH"
---
Contested control never ends with the attacker holding the money: the funds walk away to the owner's own safe address.
