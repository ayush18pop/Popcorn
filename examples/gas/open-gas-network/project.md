---
name: "Open Gas Network"
problem: "Gasless apps rely on a paymaster server that signs each approval. It can go down, refuse a country or drop a user, and nobody can see why."
modules:
  - { id: open-sponsor, role: "The community's sponsor: its policy, budgets and fee cap are public code, and nothing is signed off chain" }
  - { id: membership-proof, role: "A member admits one account without saying which member they are: anonymous and Sybil-resistant" }
  - { id: caller-pays, role: "The app's account approves its own action and lets the sponsor pay" }
featured: "a member's first sponsored transaction, which admits their account"
---
Members of a community get free transactions from a sponsor nobody can switch off, and the sponsor never learns who they are.
