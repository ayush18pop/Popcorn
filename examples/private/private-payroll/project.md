---
order: 2
name: "Private Payroll"
problem: "Salaries paid on chain are public: anyone can see who earns what, and moving the money links the employee's addresses together."
modules:
  - { id: stealth-vault, role: "Each salary goes to a one-time address only the employee can recognise; the announcement is ML-KEM, so it stays private against a future quantum computer" }
  - { id: contract-pays-the-gas, role: "The employee moves the salary to a fresh address with no ETH; the vault pays the gas out of the salary" }
  - { id: private-pool, role: "Savings wait in a private pool and come out later to any address, unlinkable to the deposit" }
  - { id: prove-youre-in-the-group, role: "The withdrawal proves its deposit is in an accepted association set, so honest users are not mixed with flagged funds" }
featured: "the employee's first spend from the stealth address"
---
An employer pays salaries without publishing a payroll; employees spend and save without a relayer, a gas top-up or a link between their addresses.
