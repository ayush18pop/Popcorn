# Popcorn

**OpenZeppelin for frame transactions.** Reviewed building blocks for keeping DeFi secure on [EIP-8141](https://eips.ethereum.org/EIPS/eip-8141) frame transactions and the [ERC-8421](https://ethereum-magicians.org/t/erc-8421-frame-transaction-alternative-mempools/29800) alternative mempool.

Frame transactions let a contract approve and pay for its own transactions. Popcorn provides the safe defaults for that: rule contracts that act when a condition is true, conditions and signers to build rules from, safe gas payment, and tooling that tells you which mempool will accept a transaction.

## Repository layout

| Path | Contents |
|---|---|
| `contracts/` | Solidity and Yul contracts (Foundry) |
| `docs/` | Design notes and decisions |

Status: work in progress. Reviewed by the team, not externally audited.

## License

MIT
