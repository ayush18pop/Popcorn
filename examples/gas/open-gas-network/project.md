---
order: 3
name: "Open Gas Network"
problem: "Gasless apps rely on a paymaster server that signs each approval. It can go down, refuse a country or drop a user, and nobody can see why."
modules:
  - { id: public-gas-sponsor, role: "The community's sponsor: its policy, budgets and fee cap are public code, and nothing is signed off chain" }
  - { id: prove-youre-in-the-group, role: "A member admits one account without saying which member they are: anonymous and Sybil-resistant" }
  - { id: payer-gets-rewarded, role: "The app's account lets another account pay its gas (here the sponsor, with no reward)" }
featured: "a member's first sponsored transaction, which admits their account"
---
Members of a community get free transactions from a sponsor nobody can switch off, and the sponsor never learns who they are.
