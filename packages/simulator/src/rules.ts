// The rule table: every rejection the Popcorn stack can produce, in plain English, with a fix.
//
// Sources (collect, not invent):
//  - core:    contracts/core/LAYOUT.md "Error codes" (0x01-0x3c), caller-pays (0x40-0x4b) and the owner path (0x50-0x6a).
//  - ethrex:  strings recorded on the devnets and in contracts/core/SPEC.md section 9,
//             docs/gate0/budgets-upstream-ethrex.txt, and ethrex crates/networking/rpc/ethrex.rs.
//  - sidecar: mempool-workshop-sidecar packages/executor/.../UserOpValidation/validators/frameTx.ts,
//             utils/validationPrefix.ts and packages/types/src/explorer (rule ids).
//  - sdk:     checks the simulator makes itself from the SimulateResult numbers.

import type { Rule, Severity } from "./types.ts";

const hex2 = (n: number) => `0x${n.toString(16).padStart(2, "0")}`;
const SDK_BUILD = "Build the trigger with the SDK (simulate()/trigger()) instead of hand-assembling the frame transaction.";

type CoreRow = [code: number, title: string, short: string, sentence: string, fix: string, severity?: Severity];

const coreRows: CoreRow[] = [
  // ---- VERIFY (Core)
  [0x01, "Rule contract is not in rule-pays mode", "rule contract mode is not rule-pays", "Core's VERIFY routine ran for a rule contract whose mode word is not 0 (rule-pays).", "Deploy the rule contract through the factory with mode 0; do not edit the immutable arguments."],
  [0x02, "VERIFY did not run as frame 0", "VERIFY is not frame 0", "Core's VERIFY ran somewhere other than the first frame of the transaction.", SDK_BUILD],
  [0x03, "Frame 0 is not a VERIFY frame", "frame 0 is not a VERIFY frame", "The first frame of the transaction is not in VERIFY mode, so Core refuses to approve it.", SDK_BUILD],
  [0x04, "Transaction sender is not the rule contract", "tx sender is not the rule contract", "The transaction's sender is not this rule contract, so it cannot spend the rule contract's balance.", "Set tx.sender to the rule contract address (the SDK does this)."],
  [0x05, "Transaction does not have two frames", "frame count is not 2", "A rule-pays trigger must have exactly two frames (VERIFY then SENDER), and this one does not.", SDK_BUILD],
  [0x06, "Frame 0 does not target the rule contract", "frame 0 does not target the rule contract", "The VERIFY frame points at a different contract than the rule contract itself.", SDK_BUILD],
  [0x07, "Frame 0 flags are wrong", "frame 0 flags are not 3", "The VERIFY frame must approve both execution and payment (flags 3), and it does not.", SDK_BUILD],
  [0x08, "Frame 1 is not a SENDER frame", "frame 1 is not a SENDER frame", "The second frame, which runs the action, is not in SENDER mode.", SDK_BUILD],
  [0x09, "Frame 1 does not target the rule contract", "frame 1 does not target the rule contract", "The action frame points at a different contract than the rule contract itself.", SDK_BUILD],
  [0x0a, "Frame 1 flags are wrong", "frame 1 flags are not 0", "The action frame must have flags 0, and it does not.", SDK_BUILD],
  [0x0b, "Not exactly one nonce key", "nonce key count is not 1", "The transaction must carry exactly one nonce key, and it carries a different number.", SDK_BUILD],
  [0x0c, "Transaction carries signatures", "tx has signatures", "A rule-pays trigger must carry no signatures (the rule contract signs with its condition), and this one has some.", "Remove the signatures; the rule contract needs no key."],
  [0x0d, "Transaction carries blobs", "tx has blobs", "A rule-pays trigger must not carry blobs.", "Remove the blob data from the transaction."],
  [0x0e, "Action calldata is not pop(bytes)", "action calldata is not pop(bytes)", "The action frame's calldata does not start with the pop(bytes) selector.", SDK_BUILD],
  [0x0f, "Action calldata has a bad offset", "action calldata offset is wrong", "The ABI offset word in the action calldata is not 0x20.", SDK_BUILD],
  [0x10, "Action calldata length is inconsistent", "action calldata length is wrong", "The triggerData length claimed in the action calldata does not fit inside the calldata.", SDK_BUILD],
  [0x11, "Action calldata is not canonical", "action calldata is not canonical", "The action calldata is not the single canonical encoding of its triggerData (wrong total length or trailing bytes).", SDK_BUILD],
  [0x12, "Fee cap above the rule contract's maximum", "max fee is above the rule contract's cap", "The transaction's max fee per gas is higher than the maximum this rule contract agreed to pay.", "Lower maxFeePerGas to the rule contract's cap, or deploy a rule contract with a higher maxFeePerGas."],
  [0x13, "Priority fee above the rule contract's maximum", "priority fee is above the rule contract's cap", "The transaction's priority fee is higher than the maximum this rule contract agreed to pay.", "Lower maxPriorityFeePerGas to the rule contract's cap, or deploy a rule contract with a higher one."],
  [0x14, "VERIFY gas limit above the rule contract's maximum", "VERIFY gas limit is above the rule contract's cap", "Frame 0's gas limit is higher than the rule contract's maxGasPerFrame.", "Declare no more VERIFY gas than the rule contract's maxGasPerFrame, or deploy a rule contract with a higher cap."],
  [0x27, "VERIFY gas limit below the floor", "VERIFY gas limit is below the floor", "Frame 0's gas limit is lower than the least Core needs to run the condition, so the condition could run out of gas.", "Raise the VERIFY gas limit to at least the floor reported by simulate() (floor)."],
  [0x15, "Action gas limit is not the cap", "action gas limit is not the cap", "Frame 1's gas limit must be exactly the rule contract's maxGasPerFrame, and it is not.", SDK_BUILD],
  [0x16, "VERIFY frame has a state gas limit", "VERIFY has a state gas limit", "Frame 0 must have a state gas limit of 0, and it does not.", SDK_BUILD],
  [0x17, "Action state gas limit is not the cap", "action state gas limit is not the cap", "Frame 1's state gas limit must be exactly the rule contract's maxStateGasPerFrame, and it is not.", SDK_BUILD],
  [0x18, "VERIFY frame sends value", "VERIFY frame sends value", "Frame 0 carries a non-zero value, which a VERIFY frame may never do.", "Set the VERIFY frame's value to 0."],
  [0x19, "Action frame sends value", "action frame sends value", "Frame 1 carries a non-zero value, which a rule contract trigger may not do.", "Set the action frame's value to 0; move ETH from inside __action instead."],
  [0x1a, "Worst-case cost above the rule contract's bound", "worst-case cost is above the bound", "The most this transaction can charge the rule contract exceeds the bound set by the rule contract's own caps.", "Shrink the transaction (gas limits, verifyData, triggerData) or deploy a rule contract with larger caps."],
  [0x1b, "__nonceKey call failed", "__nonceKey reverted or ran out of gas", "The rule contract logic's __nonceKey function reverted or ran out of its 10,000 gas.", "Make __nonceKey a cheap pure function of triggerData that never reverts."],
  [0x1c, "__nonceKey returned the wrong size", "__nonceKey returned the wrong size", "The rule contract logic's __nonceKey must return exactly 32 bytes, and it did not.", "Return a single uint256 from __nonceKey."],
  [0x1d, "Nonce key is zero", "nonce key is zero", "The logic returned nonce key 0, which is reserved.", "Return a non-zero key from __nonceKey (derive it from triggerData)."],
  [0x1e, "Transaction nonce key does not match", "tx nonce key does not match the logic's", "The nonce key on the transaction differs from the key the rule contract logic derives from triggerData.", "Use the nonce key the SDK derives (simulate() nonceKey); do not set your own."],
  [0x1f, "Nonce sequence is not zero", "nonce sequence is not 0", "A rule contract trigger must use nonce sequence 0 of its key, and this transaction does not.", SDK_BUILD],
  [0x20, "Condition reverted during validation", "the condition writes storage during validation, or reverts on its own", "The rule contract's __condition function reverted or halted while validating. Measured on the local devnet: a condition that writes storage (SSTORE) during validation ends exactly here, with this code and no other text, and so does a plain revert or running out of gas.", "If the condition writes storage during validation, move the write into __action; otherwise fix its revert or raise conditionGas (keep VERIFY under the budget)."],
  [0x21, "Condition returned the wrong size", "the condition returned the wrong size", "The rule contract's __condition function must return exactly 32 bytes (a bool word), and it did not.", "Return a single bool from __condition."],
  [0x22, "Condition is false", "the condition is false", "The rule contract's condition is not true right now, so it will not sign this trigger.", "Wait until the condition holds (or fix the triggerData), then simulate again."],
  [0x23, "Transaction references recent roots", "tx has recent-root references", "A rule contract trigger must not carry EIP-8272 recent-root references (not supported in v0).", "Remove the recent-root references from the transaction."],
  [0x24, "VERIFY data too long", "verifyData is too long", "Frame 0's data is longer than the rule contract's maxVerifyDataLength.", "Shorten verifyData, or deploy a rule contract with a larger maxVerifyDataLength."],
  [0x25, "triggerData too long", "triggerData is too long", "The triggerData are longer than the rule contract's maxTriggerDataLength.", "Shorten triggerData, or deploy a rule contract with a larger maxTriggerDataLength."],
  [0x26, "triggerData padding is not zero", "triggerData padding is not zero", "The ABI padding after triggerData contains non-zero bytes.", SDK_BUILD],
  // ---- SENDER (the action frame; the trigger was already valid)
  [0x30, "Not running in a SENDER frame", "not in a SENDER frame", "Core's action routine was reached outside a SENDER frame.", "Do not call the rule contract's trigger path directly; send a real trigger.", "warns"],
  [0x31, "Rule contract mode is not rule-pays (action)", "rule contract mode is not rule-pays", "Core's action routine ran for a rule contract whose mode word is not 0.", "Deploy the rule contract through the factory with mode 0.", "warns"],
  [0x32, "Action calldata is not pop(bytes)", "action calldata is not pop(bytes)", "The action calldata does not start with the pop(bytes) selector.", SDK_BUILD, "warns"],
  [0x33, "Action calldata has a bad offset", "action calldata offset is wrong", "The ABI offset word in the action calldata is not 0x20.", SDK_BUILD, "warns"],
  [0x34, "Action calldata length is inconsistent", "action calldata length is wrong", "The triggerData length claimed in the action calldata does not fit inside it.", SDK_BUILD, "warns"],
  [0x35, "Action calldata is not canonical", "action calldata is not canonical", "The action calldata is not the single canonical encoding of its triggerData.", SDK_BUILD, "warns"],
  [0x36, "Action triggerData padding is not zero", "triggerData padding is not zero", "The ABI padding after triggerData in the action frame contains non-zero bytes.", SDK_BUILD, "warns"],
  [0x37, "Re-entry into the action blocked", "action re-entered", "The rule contract's action tried to call back into the rule contract's own trigger path while it was running; Core blocks that so the action runs once.", "Remove the self-call from __action; call logic functions directly instead.", "warns"],
  [0x3b, "Action not sent by the rule contract itself", "tx sender is not the rule contract (action)", "Core's action routine only runs inside the rule contract's own trigger, and this transaction's sender is another account.", "Do not reach the rule contract's trigger path from another transaction; send the rule contract's own trigger.", "warns"],
  [0x3c, "Action is not in frame 1", "action is not in frame 1", "Core's action routine ran in a frame other than the trigger's action frame.", "Do not reach the rule contract's trigger path from another transaction; send the rule contract's own trigger.", "warns"],
  // ---- FORWARD (ordinary calls to the rule contract)
  [0x38, "Reserved rule contract function called directly", "reserved hook called", "An ordinary call tried to use one of Core's reserved functions (__nonceKey, __condition, __action, trigger), which only Core may call.", "Call the logic's own public functions; never call the reserved hooks directly.", "warns"],
  [0x39, "Call refused while the action runs", "call during the action", "A forwarded call to the rule contract arrived while its action was running, and Core refuses it.", "Do not call the rule contract from inside __action; use internal calls.", "warns"],
  [0x3a, "Call has no function selector", "calldata under 4 bytes", "A call to the rule contract carried non-empty calldata shorter than 4 bytes, so there is no function to forward to.", "Send a full 4-byte selector, or send plain ETH with empty calldata.", "warns"],
  // ---- caller-pays (Core, mode 1)
  [0x40, "Wrong frame count for caller-pays", "frame count is not 3 or 4", "A caller-pays trigger needs rule contract VERIFY, payer VERIFY, SENDER and at most one tail frame (3 or 4 frames), and this one does not fit.", SDK_BUILD],
  [0x41, "Rule contract frame must approve execution only", "rule contract frame flags are not 2", "In caller-pays the rule contract's VERIFY frame approves execution only (flags 2); the rule contract can never be the payer.", SDK_BUILD],
  [0x42, "Frame 1 is not the payer's VERIFY", "frame 1 is not a VERIFY frame", "The second frame must be the payer's VERIFY frame, and it is not in VERIFY mode.", SDK_BUILD],
  [0x43, "Payer frame targets the rule contract", "payer frame targets the rule contract", "The payer's frame points at the rule contract; the payer must be a different account.", "Pay with another account (an EOA or a paymaster), not the rule contract."],
  [0x44, "Payer frame must approve payment only", "payer frame flags are not 1", "The payer's VERIFY frame must approve payment only (flags 1), and it does not.", SDK_BUILD],
  [0x45, "Frame 2 is not a SENDER frame", "frame 2 is not a SENDER frame", "The third frame, which runs the action, is not in SENDER mode.", SDK_BUILD],
  [0x46, "Action frame does not target the rule contract", "action frame does not target the rule contract", "The action frame points at a different contract than the rule contract itself.", SDK_BUILD],
  [0x47, "Action frame flags are wrong", "action frame flags are not 0", "The action frame must have flags 0 (no approval, no atomic batch with the tail), and it does not.", SDK_BUILD],
  [0x48, "Tail frame is not a DEFAULT frame", "tail frame is not DEFAULT mode", "An optional fourth frame must be a DEFAULT frame; a second SENDER frame would act as the rule contract against any target.", "Make the tail frame DEFAULT mode, or drop it."],
  [0x49, "Tail frame targets the rule contract", "tail frame targets the rule contract", "The tail frame points at the rule contract, which would hit Core with the entry-point caller.", "Point the tail frame at another contract, or drop it."],
  [0x4a, "Tail frame flags are wrong", "tail frame flags are not 0", "The tail frame must have flags 0, and it does not.", "Set the tail frame's flags to 0."],
  [0x4b, "Tail frame sends value", "tail frame sends value", "The tail frame carries a non-zero value, which it may not.", "Set the tail frame's value to 0."],
  // ---- OWNER path: hybrid ECDSA + WOTS+ owner transactions
  [0x50, "Owner tx has the wrong frame count", "owner frame count is wrong", "An owner transaction must have 3 frames (VERIFY, bump, owner call), or 4 with a payer frame in caller-pays mode, and this one does not.", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x51, "Owner tx uses the wrong nonce key", "owner nonce key is wrong", "Owner transactions must use the fixed owner nonce key, and this one uses another.", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x52, "Owner tx has the wrong number of signatures", "owner signature count is wrong", "A rule-pays owner transaction must carry exactly two signature entries (ECDSA, then WOTS+); a caller-pays one at least two.", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x53, "Owner call is too long", "owner call is too long", "The owner call is longer than 1,024 bytes.", "Split the action into smaller owner calls."],
  [0x54, "Owner call has no selector", "owner call has no selector", "The owner call is shorter than 4 bytes, so it has no function selector.", "Pass an ABI-encoded call to ownerAction()."],
  [0x55, "Owner call targets a reserved selector", "owner call uses a reserved selector", "Owner calls may not be Core's own entry points (trigger, __nonceKey, __condition, __action, owner, ownerBump).", "Call one of the logic's onlyOwnerCall functions instead."],
  [0x56, "Owner bump frame gas limit out of range", "owner bump gas limit is out of range", "The bump frame that spends the WOTS leaf must have a gas limit between 30,000 and 100,000.", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x57, "ECDSA signature entry is not ARBITRARY", "ECDSA entry is the wrong scheme", "The owner's ECDSA signature must be an ARBITRARY entry (the second to last signature), not a protocol-checked scheme.", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x58, "ECDSA signature entry has a message", "ECDSA entry has a msg", "The ECDSA entry must have an empty msg so it signs the transaction's signature hash.", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x59, "ECDSA signature entry has the wrong length", "ECDSA entry is not 65 bytes", "The ECDSA entry must be exactly 65 bytes (r, s, v).", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x5a, "WOTS signature entry is not ARBITRARY", "WOTS entry is the wrong scheme", "The owner's WOTS+ signature must be an ARBITRARY entry (the last signature).", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x5b, "WOTS signature entry has a message", "WOTS entry has a msg", "The WOTS+ entry must have an empty msg so its bytes are left out of the hash it signs.", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x5c, "WOTS signature entry has the wrong length", "WOTS entry is not 2,496 bytes", "The WOTS+ entry must be exactly 2,496 bytes (leaf, 67 chain values, 10 path nodes).", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x5d, "Rule contract has no owner", "rule contract has no owner", "This rule contract was deployed without an owner (or has no staged rotation for a finalize), so the owner path is off.", "Deploy the rule contract with an owner (deployRule({ owner })); an ownerless rule contract cannot be given one later."],
  [0x5e, "Owner VERIFY frame carries data", "owner VERIFY data is not empty", "The owner transaction's VERIFY frame must have empty data.", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x5f, "ECDSA signature does not match the owner", "ECDSA signature is not the owner's", "The recovered ECDSA signer of the transaction's signature hash is not the rule contract's owner key (a wrong key, or the tx was changed after signing).", "Sign with the owner's ECDSA key, and do not change the tx after signing."],
  [0x60, "WOTS leaf out of range", "WOTS leaf is out of range", "The WOTS+ leaf index is 1,024 or more, past the end of the tree.", "Rotate the owner to a fresh tree before the last leaves are used."],
  [0x61, "WOTS leaf already spent", "WOTS leaf is already spent", "The WOTS+ leaf was used before (it is below the rule contract's wotsIndex); one-time keys must never sign twice.", "Use the next unused leaf (ownerAction() reads wotsIndex and skips spent leaves)."],
  [0x62, "WOTS signature does not verify", "WOTS signature is invalid", "The WOTS+ signature or its Merkle path does not verify against the owner's tree root for this transaction.", "Sign with the owner's WOTS+ tree, and do not change the tx after signing."],
  [0x63, "Owner call ran without its bump frame", "owner bump frame did not succeed", "The frame before the owner call (which spends the WOTS leaf) did not succeed, so the call refuses to run.", "Give the bump frame a gas limit of at least 30,000."],
  [0x65, "Owner bump frame data is wrong", "owner bump data is wrong", "The bump frame's data must be exactly the 4-byte ownerBump() selector.", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x66, "Owner call frame is not a SENDER frame", "owner call frame is not SENDER", "The frame that carries the owner call must be a SENDER frame.", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x67, "Owner call frame targets another contract", "owner call frame does not target the rule contract", "The owner call frame must target the rule contract itself.", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x68, "Owner call frame flags are wrong", "owner call frame flags are not 0", "The owner call frame must have flags 0 (no atomic batch with the bump).", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x69, "Owner call frame is not owner(bytes)", "owner call frame data is not owner(bytes)", "The owner call frame's data must start with the owner(bytes) selector.", "Build the tx with ownerAction() / buildOwnerTx()."],
  [0x6a, "ECDSA signature is malleable", "ECDSA signature is high-s or v is not 27/28", "Core accepts one encoding per ECDSA signature: v must be 27 or 28 and s at most half the curve order.", "Sign with a standard library (viem) which produces low-s signatures."],
];

const coreRules: Rule[] = coreRows.map(([code, title, short, sentence, fix, severity = "blocks"]) => ({
  id: `CORE_${hex2(code)}`,
  source: "core",
  matcher: { core: code },
  title,
  short,
  sentence: `Core ${hex2(code)}: ${sentence}`,
  fix,
  severity,
  mempool: "both",
}));

const STAKE_FIX = "Stake the rule contract: deployRule({ stake: true }) or stakeRuleContract(rule contract), then simulate again.";

// Order matters: the first matching regex wins, so the specific rules come before the broad ones.
const messageRules: Rule[] = [
  // ------------------------------------------------------------------ ethrex (public mempool)
  {
    id: "ETHREX_STORAGE_READ_NON_SENDER", source: "ethrex", matcher: { re: /StorageReadNonSender/ },
    title: "Reads another contract's storage", short: "reads another contract's storage",
    sentence: "Validation reads storage that belongs to another contract; the public mempool only allows a rule contract to read its own storage, and it has no stake exception.",
    fix: "Keep the condition on the rule contract's own storage for the public mempool, or send this trigger through an alt-mempool sidecar (stake the rule contract so it admits the read).",
    severity: "blocks", mempool: "public",
  },
  {
    id: "ETHREX_PREFIX_BUDGET", source: "ethrex", matcher: { re: /exceeds MAX_VERIFY_GAS|prefix gas budget exceeded|prefix gas budget/ },
    title: "Validation gas over the public budget", short: "validation gas is over the public budget",
    sentence: "The validation prefix declares more gas than the public mempool's VERIFY budget (100,000 on devnet1).",
    fix: "Cut the condition's gas below the public budget, or send this trigger through an alt-mempool sidecar (250,000 unstaked, 2,500,000 staked).",
    severity: "blocks", mempool: "public",
  },
  {
    id: "ETHREX_NONCE_MISMATCH", source: "ethrex", matcher: { re: /Nonce mismatch/i },
    title: "Nonce already used", short: "this trigger was already included",
    sentence: "The trigger's nonce key has already been used (expected sequence 1, got 0), so this exact trigger already ran and cannot run again.",
    fix: "Build a new trigger with fresh triggerData (a new nonce key) if the rule contract should fire again.",
    severity: "blocks", mempool: "both",
  },
  {
    id: "ETHREX_SIGNATURE_LIST", source: "ethrex", matcher: { re: /signature list does not authenticate the sender/ },
    title: "Signatures do not authenticate sender", short: "the signatures do not authenticate the sender",
    sentence: "The transaction's signature list does not authenticate its sender; a rule contract trigger should carry no signatures at all.",
    fix: "Build the trigger with the SDK and send it unsigned; a rule contract needs no key.",
    severity: "blocks", mempool: "both",
  },
  {
    id: "ETHREX_VERIFY_VALUE", source: "ethrex", matcher: { re: /non-zero value only allowed in SENDER mode/ },
    title: "VERIFY frame sends value", short: "the VERIFY frame sends value",
    sentence: "The VERIFY frame carries a non-zero value, which the protocol allows only in SENDER frames.",
    fix: "Set the VERIFY frame's value to 0.", severity: "blocks", mempool: "both",
  },
  {
    id: "ETHREX_WRITE_DURING_VERIFY", source: "ethrex",
    matcher: { re: /wrote state|SSTORE|StorageWrite|StateWrite|static_violation/i }, // measured: ethrex and the sidecar show Core 0x20 for an SSTORE in VERIFY, so these strings are only a safety net
    title: "Writes storage during validation", short: "writes storage during validation",
    sentence: "The condition (VERIFY path) writes storage or sends value; validation is read-only, so no mempool will accept it.",
    fix: "Move every write into __action (the SENDER frame) and keep __condition a pure read.",
    severity: "blocks", mempool: "both",
  },
  {
    id: "ETHREX_BANNED_OPCODE", source: "ethrex", matcher: { re: /BannedOpcode\(|(?<!uses )banned opcode: \w+ \(0x/ },
    title: "Uses a banned opcode", short: "uses a banned opcode in validation",
    sentence: "Validation executes an opcode that is banned during VERIFY (for example TIMESTAMP, GASPRICE, BLOCKHASH or ORIGIN), because its value could change between simulation and inclusion.",
    fix: "Remove the banned opcode from __condition and __nonceKey; read the value in __action instead, or use only own storage.",
    severity: "blocks", mempool: "both",
  },
  {
    id: "ETHREX_CALL_TO_NONEXISTENT", source: "ethrex", matcher: { re: /CallToNonexistentOrDelegated/ },
    title: "Calls an undeployed or delegated account", short: "calls an undeployed account",
    sentence: "Validation calls an address that has no code or is a delegated account, which the public mempool refuses.",
    fix: "Call only deployed contracts (with real code) from the condition.", severity: "blocks", mempool: "public",
  },
  {
    id: "ETHREX_VERIFY_REVERT_OPAQUE", source: "ethrex", matcher: { re: /VERIFY frame \d+.*failed: RevertOpcode/i },
    title: "VERIFY frame reverted without data", short: "the VERIFY frame reverted (no Core code given)",
    sentence: "The VERIFY frame reverted and ethrex gave no Core code and no reason. Measured: this is what ethrex says when the paying account cannot cover the transaction's maximum cost; it also appears for a frame layout it does not recognise (a wrong frame count, flags or target).",
    fix: "Check the paying account's balance against maxCost first; otherwise build the trigger with the SDK and check the frame flags and targets against core/SPEC.md.",
    severity: "blocks", mempool: "both",
  },
  {
    id: "ETHREX_INSUFFICIENT_FUNDS", source: "ethrex", matcher: { re: /insufficient funds|InsufficientFunds|lack of funds|insufficient balance/i },
    title: "Rule contract cannot pay for the trigger", short: "the rule contract balance can't cover the worst-case trigger",
    sentence: "The rule contract's balance is below the most this trigger can cost, so the node refuses to reserve the fee.",
    fix: "Send ETH to the rule contract (at least maxCost per trigger; minOperatingBalance is the safe floor).",
    severity: "blocks", mempool: "both",
  },
  // ------------------------------------------------------------------ sidecar (alt mempool)
  {
    id: "SIDECAR_BUDGET_010", source: "sidecar", matcher: { re: /exceeds (?:staked|unstaked) budget \d+ \(BUDGET-010\)|BUDGET-010/ },
    title: "Validation gas over the alt budget", short: "validation gas is over the alt budget",
    sentence: "BUDGET-010: the entity's validation gas is over its budget, 250,000 unstaked or 2,500,000 staked.",
    fix: "Lower the condition's gas below 250,000, or stake the rule contract to raise the budget to 2,500,000 (the stake trigger itself must fit 250,000).",
    severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_UNSTAKED_ACCESS", source: "sidecar", matcher: { re: /unstaked (?:sender|payer|factory|paymaster|\w+) accessed/ },
    title: "Reads another contract without a stake", short: "that read needs a stake; this rule contract has none",
    sentence: "The unstaked rule contract reads (or touches) another contract's storage during validation, and the alt mempool allows that only for a staked entity (rule STO).",
    fix: STAKE_FIX, severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_STO_FORBIDDEN_WRITE", source: "sidecar", matcher: { re: /has forbidden write to/ },
    title: "Writes another contract's storage", short: "writes storage it may not write",
    sentence: "Validation writes to storage the entity is not allowed to write, even if it were staked (rule STO).",
    fix: "Remove the write from the condition; validation must be read-only.", severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_STO_FORBIDDEN_READ", source: "sidecar", matcher: { re: /has forbidden read from/ },
    title: "Reads storage it may not read", short: "reads storage it may not read",
    sentence: "Validation reads a contract's storage that no stake can make allowed (rule STO).",
    fix: "Stop reading that slot in the condition, or copy the value into the rule contract's own storage.", severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_PAYER_BALANCE", source: "sidecar", matcher: { re: /the payer 0x[0-9a-fA-F]+ has \d+ wei/ },
    title: "Payer balance below the maximum cost", short: "the rule contract balance can't cover the worst-case trigger",
    sentence: "The paying account (the rule contract) holds less ETH than the transaction's maximum cost.",
    fix: "Send ETH to the rule contract (at least maxCost per trigger).", severity: "blocks", mempool: "both",
  },
  {
    id: "SIDECAR_PREFIX_NOT_RECOGNIZED", source: "sidecar", matcher: { re: /validation prefix not recognized/ },
    title: "Frame layout not recognised", short: "the frame layout is not a known trigger shape",
    sentence: "The sidecar does not recognise the transaction's frames as a valid validation prefix (self-verify or verify-and-pay).",
    fix: "Build the trigger with the SDK so the frames follow the two-frame rule-pays shape.", severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_STRUCTURE_TARGET", source: "sidecar", matcher: { re: /frame \d+ \(.+\) targets .+ expected tx\.sender/ },
    title: "Validation frame targets the wrong account", short: "a validation frame targets the wrong account",
    sentence: "A validation frame targets an account other than the transaction sender.",
    fix: "Target the rule contract (or null) from the VERIFY frame.", severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_STRUCTURE_ATOMIC", source: "sidecar", matcher: { re: /ATOMIC_BATCH_FLAG/ },
    title: "Atomic batch inside validation", short: "an atomic-batch flag is set in validation",
    sentence: "A frame in the validation prefix has the atomic-batch flag set, which is not allowed there.",
    fix: "Clear the atomic-batch flag on the VERIFY frame.", severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_STATE_GAS", source: "sidecar", matcher: { re: /MAX_VERIFY_STATE_GAS/ },
    title: "Validation state gas too high", short: "validation state gas is too high",
    sentence: "The validation prefix declares more state gas than MAX_VERIFY_STATE_GAS.",
    fix: "Set the VERIFY frame's state gas limit to 0.", severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_VERIFY_AFTER_PREFIX", source: "sidecar", matcher: { re: /is a VERIFY frame after the validation prefix/ },
    title: "VERIFY frame after the prefix", short: "a VERIFY frame comes after the validation prefix",
    sentence: "The transaction has a VERIFY frame after the validation prefix has ended.",
    fix: "Use only VERIFY frames at the start, then SENDER/DEFAULT frames.", severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_INVALID_SIGNATURE", source: "sidecar", matcher: { re: /Invalid frame transaction signature/ },
    title: "Invalid frame signature", short: "a signature is invalid",
    sentence: "A signature on the transaction does not verify (for a rule contract trigger there should be none; for caller-pays it is the payer's).",
    fix: "Re-sign with the payer's key over the transaction's signature hash, or drop the signature on a rule-pays trigger.",
    severity: "blocks", mempool: "both",
  },
  {
    id: "SIDECAR_RECENT_ROOT", source: "sidecar", matcher: { re: /EIP-8272|recent.?root/i },
    title: "Recent-root reference unusable", short: "a recent-root reference is unusable",
    sentence: "An EIP-8272 recent-root reference is too new, expired or not committed.",
    fix: "Use a recent root inside the window, or remove the reference.", severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_OP_061", source: "sidecar", matcher: { re: /nested CALL with value/ },
    title: "Sends value during validation", short: "sends value during validation",
    sentence: "OP-061: validation makes a nested CALL with value, which is forbidden.",
    fix: "Move value transfers into __action.", severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_CREATE", source: "sidecar", matcher: { re: /uses banned opcode: CREATE2?\b|with too many CREATE2/ },
    title: "Creates a contract during validation", short: "creates a contract during validation",
    sentence: "Validation uses CREATE or CREATE2, which only a factory may do (once).",
    fix: "Deploy contracts in __action, not in the condition.", severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_OP_011", source: "sidecar", matcher: { re: /uses banned opcode/ },
    title: "Uses a banned opcode", short: "uses a banned opcode in validation",
    sentence: "OP-011: validation executes an opcode the alt mempool bans (for example TIMESTAMP, GASPRICE, BLOCKHASH or ORIGIN).",
    fix: "Remove the banned opcode from the condition; read it in __action instead.", severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_COD_010", source: "sidecar", matcher: { re: /accesses un-deployed contract address/ },
    title: "Touches an undeployed contract", short: "touches an undeployed contract",
    sentence: "COD-010: validation accesses an address that has no deployed code.",
    fix: "Call only deployed contracts from the condition.", severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_ENTRYPOINT_ACCESS", source: "sidecar", matcher: { re: /accesses EntryPoint contract address/ },
    title: "Touches the EntryPoint", short: "touches the EntryPoint",
    sentence: "Validation reads the code of the EntryPoint contract, which is not allowed.",
    fix: "Remove the EntryPoint access from the condition.", severity: "blocks", mempool: "alt",
  },
  {
    id: "SIDECAR_OUT_OF_GAS", source: "sidecar", matcher: { re: /internally reverts on oog|ran out of gas/ },
    title: "Validation ran out of gas", short: "validation ran out of gas",
    sentence: "The validation frame ran out of gas before it finished.",
    fix: "Raise the VERIFY gas limit (up to the budget), or make the condition cheaper.", severity: "blocks", mempool: "both",
  },
  {
    id: "SIDECAR_INVALID_OPCODE", source: "sidecar", matcher: { re: /hit an invalid opcode/ },
    title: "Validation hit an invalid opcode", short: "validation hit an invalid opcode",
    sentence: "The validation frame executed an invalid opcode.",
    fix: "Check the logic bytecode (compiler target and EVM version) for the opcode.", severity: "blocks", mempool: "both",
  },
  {
    id: "SIDECAR_VERIFY_REVERT_DATA", source: "sidecar", matcher: { re: /validation frame \d+: reverted(?: with data (0x[0-9a-fA-F]*))?\s*$/ },
    title: "VERIFY frame reverted", short: "the VERIFY frame reverted",
    sentence: "The VERIFY frame reverted with data that is not a Core code, so the rule contract's own logic reverted.",
    fix: "Check what __condition and __nonceKey revert on; the raw revert data is in the evidence.", severity: "blocks", mempool: "both",
  },
  {
    id: "SIDECAR_PREFIX_REVERTED", source: "sidecar", matcher: { re: /validation prefix frame reverted/ },
    title: "Validation prefix reverted", short: "the validation prefix reverted",
    sentence: "The validation prefix failed (a revert, a loop or running out of gas) and the node gave no more detail.",
    fix: "Simulate through ethrex to get the Core code, and check the VERIFY gas limit.", severity: "blocks", mempool: "both",
  },
  {
    id: "SIDECAR_TRACE_INTERNAL", source: "sidecar", matcher: { re: /trace-alignment|frame trace|misalignment|missing trace into/ },
    title: "Sidecar could not trace the trigger", short: "the sidecar could not trace the trigger",
    sentence: "The sidecar could not match its execution trace to the transaction's frames; this is an internal tracing failure, not a verdict on the rule contract.",
    fix: "Retry; if it persists, report the raw message with the transaction.", severity: "blocks", mempool: "alt",
  },
];

const sdkRules: Rule[] = [
  {
    id: "SDK_BALANCE_BELOW_MAX_COST", source: "sdk", matcher: { fallback: true },
    title: "Rule contract balance below worst-case trigger", short: "the rule contract balance can't cover the worst-case trigger",
    sentence: "The rule contract's balance is lower than the most this trigger can cost (maxCost), so no node will reserve the fee.",
    fix: "Send ETH to the rule contract: at least maxCost, and minOperatingBalance to keep it firing.", severity: "blocks", mempool: "both",
  },
  {
    id: "SDK_PAYER_BALANCE_BELOW_MAX_COST", source: "sdk", matcher: { fallback: true },
    title: "Payer balance below worst-case trigger", short: "the payer's balance can't cover the worst-case trigger",
    sentence: "In caller-pays mode the payer reserves the fee, and the payer's balance is lower than the most this trigger can cost (maxCost).",
    fix: "Fund the payer account with at least maxCost, or pay from another account.", severity: "blocks", mempool: "both",
  },
  {
    id: "SDK_BALANCE_BELOW_MIN_OPERATING", source: "sdk", matcher: { fallback: true },
    title: "Rule contract balance below operating minimum", short: "the rule contract balance is below its operating minimum",
    sentence: "The rule contract can pay for this trigger but holds less than minOperatingBalance, so it may be unable to pay for a later one.",
    fix: "Top the rule contract up to at least minOperatingBalance.", severity: "warns", mempool: "both",
  },
  {
    id: "SDK_ALT_ONLY", source: "sdk", matcher: { fallback: true },
    title: "Only the alt mempool accepts this", short: "only the alt mempool accepts this",
    sentence: "This trigger is valid for the ERC-8421 alt mempool but not for the public mempool, so only a sidecar can relay it.",
    fix: "Send it through an alt-mempool sidecar; to reach the public mempool, cut VERIFY gas to the public budget and read only the rule contract's own storage.",
    severity: "warns", mempool: "alt",
  },
  {
    id: "SDK_ALT_OVER_UNSTAKED_BUDGET", source: "sdk", matcher: { fallback: true },
    title: "Over the unstaked alt budget", short: "validation gas is over the unstaked alt budget",
    sentence: "The declared VERIFY gas is above the alt mempool's 250,000 unstaked budget, so an unstaked rule contract will be refused (a staked one gets 2,500,000).",
    fix: STAKE_FIX, severity: "blocks", mempool: "alt",
  },
  {
    id: "SDK_STAKED_READ_PUBLIC_ONLY", source: "sdk", matcher: { fallback: true },
    title: "Staked rule contract, still refused publicly", short: "public ethrex has no stake exception",
    sentence: "The rule contract is staked, which is what the alt mempool needs to admit reads of other contracts; public ethrex refuses those reads anyway.",
    fix: "Send this trigger through an alt-mempool sidecar; for the public mempool keep the condition on the rule contract's own storage.", severity: "warns", mempool: "public",
  },
  {
    id: "SDK_ACTION_REVERTS", source: "sdk", matcher: { fallback: true },
    title: "Trigger is valid but the action reverts", short: "the action (SENDER frame) reverts",
    sentence: "The trigger passes validation, but its action reverts when it runs, so the rule contract would pay for nothing.",
    fix: "Simulate __action on its own and fix what it reverts on before sending.", severity: "warns", mempool: "both",
  },
  {
    id: "SDK_SIDECAR_UNREACHABLE", source: "sdk", matcher: { fallback: true },
    title: "Alt mempool could not be asked", short: "the sidecar could not be reached",
    sentence: "The sidecar did not answer, so the alt-mempool verdict is a prediction from the ethrex result only.",
    fix: "Start the sidecar (or check its URL) and simulate again.", severity: "warns", mempool: "alt",
  },
  {
    id: "SDK_UNKNOWN_CORE_CODE", source: "sdk", matcher: { fallback: true },
    title: "Unknown Core error code", short: "Core reverted with an unknown code",
    sentence: "Core reverted with a code this simulator does not know; the raw code is in the evidence.",
    fix: "Look the code up in core/LAYOUT.md; this simulator may be older than the Core build.", severity: "blocks", mempool: "both",
  },
  {
    id: "SDK_UNKNOWN_ETHREX", source: "sdk", matcher: { fallback: true },
    title: "Unrecognised ethrex rejection", short: "ethrex rejected it (unrecognised message)",
    sentence: "ethrex rejected the trigger with a message this simulator does not recognise; the raw message is in the evidence.",
    fix: "Read the raw message in the evidence; add a rule for it if it recurs.", severity: "blocks", mempool: "public",
  },
  {
    id: "SDK_UNKNOWN_SIDECAR", source: "sdk", matcher: { fallback: true },
    title: "Unrecognised sidecar rejection", short: "the sidecar rejected it (unrecognised message)",
    sentence: "The sidecar rejected the trigger with a message this simulator does not recognise; the raw message is in the evidence.",
    fix: "Read the raw message in the evidence; add a rule for it if it recurs.", severity: "blocks", mempool: "alt",
  },
];

export const RULES: readonly Rule[] = [...coreRules, ...messageRules, ...sdkRules];

export const RULES_BY_ID: ReadonlyMap<string, Rule> = new Map(RULES.map((r) => [r.id, r]));
export const CORE_RULES: ReadonlyMap<number, Rule> = new Map(coreRules.map((r) => [(r.matcher as { core: number }).core, r]));

export const ruleById = (id: string): Rule => {
  const r = RULES_BY_ID.get(id);
  if (!r) throw new Error(`unknown rule ${id}`);
  return r;
};

/** First message rule whose regex matches, or null. */
export function matchMessage(text: string): Rule | null {
  for (const r of messageRules) if ("re" in r.matcher && r.matcher.re.test(text)) return r;
  return null;
}

/** Core rule for a code, or null when the code is not in the table. */
export const coreRule = (code: number): Rule | null => CORE_RULES.get(code) ?? null;
