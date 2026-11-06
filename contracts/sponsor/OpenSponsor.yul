// Open Sponsor: a payer contract that pays the gas of caller-pays rule contracts under a public, on-chain policy.
//
// The problem it answers: gas sponsorship today is a server that signs each approval. The server can go down, refuse a
// country or drop an account. Here the policy is the payer's own code and storage, so whoever meets it is sponsored and
// nobody is asked.
//
// Transaction shape (Core mode 1 with its optional tail, contracts/core/LAYOUT.md):
//   frame 0  VERIFY  flags 2  rule contract   (Core: shape, key, condition; approves execution)
//   frame 1  VERIFY  flags 1  this sponsor     (the policy below; approves payment)
//   frame 2  SENDER  flags 0  rule contract   (the action)
//   frame 3  DEFAULT flags 0  this sponsor     (record(): debits the budget, admits a member, burns a nullifier)
//
// Validation (frame 1) cannot write storage, so every write happens in the tail frame, which this sponsor requires and
// gives enough gas. Validation reads only this contract's own storage, the sender's code (to find its logic) and a
// Groth16 verifier's code (no storage), never the clock or a balance. The tail may read the clock, so a period rolls
// over there, or in roll(address), which anyone may call.
//
// Who is sponsored (the sender is the rule contract, tx.sender):
//   1. limitOf[sender] > 0                                  -> that limit
//   2. otherwise, if any of these holds                      -> defaultLimit
//        open                       (everyone)
//        logicAllowed[logic(sender)] (every rule contract built on an allowed logic, e.g. every private pool)
//        admitted[sender]           (passed the membership gate once)
//        the gate is on and frame 1 data carries a membership proof for this sender (admits it in the tail)
//   otherwise not sponsored.
// Budget: spent[sender] + max_cost <= limit, and max_fee_per_gas <= maxFee. max_cost (TXPARAM 0x06) is what APPROVE
// debits, so the budget is charged the worst case and never under-counts.
//
// Membership gate (optional): a Groth16 proof that the sender is controlled by a member of a set, without saying which
// member. Public inputs [root, nullifierHash, signal = sender, externalNullifier = keccak256(this sponsor) >> 8]. The
// nullifier is per member per sponsor, so each member admits ONE account: anonymous and Sybil-resistant. frame 1 data =
// proof (256 bytes) ++ nullifierHash (32 bytes).
//
// Errors: 32-byte codes, as in Core.
//   0x60 not frame 1 / not VERIFY      0x61 frame 1 flags != 1        0x62 not exactly 4 frames
//   0x63 tail is not DEFAULT           0x64 tail target is not self   0x65 tail flags != 0
//   0x66 tail value != 0               0x67 tail data != record()     0x68 tail execution limit too low
//   0x69 tail state limit too low      0x6a sender not sponsored      0x6b max fee above the cap
//   0x6c budget exhausted              0x6d nullifier already used    0x6e membership proof rejected
//   0x6f frame 1 data malformed        0x70 record(): not the tail    0x71 record(): this sponsor did not pay
//   0x72 not the owner                 0x73 unknown selector          0x74 withdraw failed
//   0x75 a staking registry call failed
//
// Mempool: the policy reads the sponsor's own global settings (fee cap, default limit, gate), which ERC-7562 lets only a
// staked payer do, so the sponsor stakes (stake(registry, delay)) and runs on the alternative mempool. Staking also
// gives it the 2,500,000-gas per-entity budget a membership proof needs on a sidecar with budgets.
object "OpenSponsor" {
  code {
    // initcode = this object ++ owner (32) ++ period (32) ++ maxFee (32) ++ defaultLimit (32)
    let a := datasize("OpenSponsor")
    if iszero(eq(codesize(), add(a, 128))) { revert(0, 0) }
    codecopy(0, a, 128)
    let base := 0x20d7ff8cd3fd5aabbec502e81f73c112c342c3ca186fbd0acaef564d877f442c // keccak256("popcorn.sponsor")
    sstore(base, mload(0))              // owner
    sstore(add(base, 1), mload(32))     // period (seconds)
    sstore(add(base, 2), mload(64))     // maxFee (wei per gas)
    sstore(add(base, 3), mload(96))     // defaultLimit (wei per period per sender)
    datacopy(0, dataoffset("runtime"), datasize("runtime"))
    return(0, datasize("runtime"))
  }

  object "runtime" {
    code {
      function txparam(id) -> v { v := verbatim_1i_1o(hex"b0", id) }
      function frameparam(param, idx) -> v { v := verbatim_2i_1o(hex"b3", idx, param) }
      function framedataload(off, idx) -> v { v := verbatim_2i_1o(hex"b1", off, idx) }
      function framedatacopy(mem, off, len, idx) { verbatim_4i_0o(hex"b2", mem, off, len, idx) }
      function approve(scope) { verbatim_3i_0o(hex"aa", 0, 0, scope) }

      // ---------------------------------------------------------------- storage (namespaced, keccak256("popcorn.sponsor"))
      // BASE+0 owner, +1 period, +2 maxFee, +3 defaultLimit, +4 open, +5 gateVerifier, +6 gateRoot
      // per sender s  at keccak(s, BASE):     +0 limit, +1 spent, +2 periodStart, +3 admitted
      // per logic l   at keccak(l, BASE+7):   allowed
      // per nullifier at keccak(n, BASE+8):   used
      function BASE() -> b { b := 0x20d7ff8cd3fd5aabbec502e81f73c112c342c3ca186fbd0acaef564d877f442c }
      function slotIn(k, family) -> p { mstore(0, k) mstore(32, add(BASE(), family)) p := keccak256(0, 64) }
      function senderSlot(s) -> p { p := slotIn(s, 0) }

      function TAIL_GAS() -> g { g := 60000 }
      function TAIL_STATE() -> g { g := 489600 }    // 5 fresh slots * 97,920: spent, periodStart, admitted, nullifier, spare
      function SEL_RECORD() -> s { s := 0x266cf109 }
      function PROOF_DATA() -> n { n := 288 }       // proof 256 ++ nullifierHash 32
      function VERIFIER_GAS() -> g { g := 260000 }  // a Groth16 check with 4 public inputs is ~210k

      function fail(code) { mstore(0, code) revert(0, 32) }
      function req(ok, code) { if iszero(ok) { fail(code) } }
      function addr(v) -> a { a := and(v, 0xffffffffffffffffffffffffffffffffffffffff) }

      // The rule contract's logic: Core's deployed code is runtime ++ 101 argument bytes, logic first (LAYOUT.md).
      function logicOf(s) -> l {
        let size := extcodesize(s)
        if lt(size, 101) { leave }
        extcodecopy(s, 0, sub(size, 101), 20)
        l := shr(96, mload(0))
      }

      function externalNullifier() -> e {
        mstore(0, address())
        e := shr(8, keccak256(12, 20))
      }

      // verify(proof, [root, nullifier, signal, externalNullifier]) on the gate verifier with a bounded stipend.
      // Returns 1 only for exactly the word 1; a revert or junk is a rejection (fail closed).
      function gateAccepts(s, nullifier) -> ok {
        let v := sload(add(BASE(), 5))
        let m := mload(0x40)
        if iszero(m) { m := 0x80 }
        mstore(m, shl(224, 0x9649daae))
        mstore(add(m, 4), 0x40)                    // proof offset
        mstore(add(m, 36), 0x160)                  // inputs offset = 0x40 + 32 + 256
        mstore(add(m, 68), 256)                    // proof length
        framedatacopy(add(m, 100), 0, 256, 1)      // the proof
        mstore(add(m, 356), 4)                     // inputs length
        mstore(add(m, 388), sload(add(BASE(), 6))) // root
        mstore(add(m, 420), nullifier)
        mstore(add(m, 452), s)
        mstore(add(m, 484), externalNullifier())
        let success := staticcall(VERIFIER_GAS(), v, m, 516, 0, 32)
        ok := and(success, and(eq(returndatasize(), 32), eq(mload(0), 1)))
      }

      // ---------------------------------------------------------------- frame 1: the policy
      function verifyPayment() {
        req(and(eq(txparam(0x0a), 1), eq(frameparam(0x02, 1), 1)), 0x60)
        req(eq(frameparam(0x03, 1), 1), 0x61)
        req(eq(txparam(0x09), 4), 0x62)
        req(eq(frameparam(0x02, 3), 0), 0x63)
        req(eq(frameparam(0x00, 3), address()), 0x64)
        req(iszero(frameparam(0x03, 3)), 0x65)
        req(iszero(frameparam(0x08, 3)), 0x66)
        req(and(eq(frameparam(0x04, 3), 4), eq(shr(224, framedataload(0, 3)), SEL_RECORD())), 0x67)
        req(iszero(lt(frameparam(0x01, 3), TAIL_GAS())), 0x68)
        req(iszero(lt(frameparam(0x09, 3), TAIL_STATE())), 0x69)

        let s := txparam(0x02)
        let p := senderSlot(s)
        let limit := sload(p)
        let gated := 0
        if iszero(limit) {
          let eligible := or(sload(add(BASE(), 4)), sload(add(p, 3)))
          if iszero(eligible) {
            let l := logicOf(s)
            if l { eligible := sload(slotIn(l, 7)) }
          }
          if iszero(eligible) {
            // the membership gate: frame 1 data carries a proof that admits this sender
            if sload(add(BASE(), 5)) {
              req(eq(frameparam(0x04, 1), PROOF_DATA()), 0x6f)
              let n := framedataload(256, 1)
              req(iszero(sload(slotIn(n, 8))), 0x6d)
              req(gateAccepts(s, n), 0x6e)
              eligible := 1
              gated := 1
            }
          }
          if eligible { limit := sload(add(BASE(), 3)) }
        }
        // frame 1 data is only for a gate admission: anything else could burn someone else's nullifier in the tail
        if iszero(gated) { req(iszero(frameparam(0x04, 1)), 0x6f) }
        req(limit, 0x6a)
        req(iszero(gt(txparam(0x04), sload(add(BASE(), 2)))), 0x6b)
        req(iszero(gt(add(sload(add(p, 1)), txparam(0x06)), limit)), 0x6c) // both far below 2^255
        approve(1)
      }

      // ---------------------------------------------------------------- frame 3: the writes
      function record() {
        req(and(eq(txparam(0x0a), 3), eq(frameparam(0x02, 3), 0)), 0x70)
        req(eq(frameparam(0x00, 1), address()), 0x71)
        let s := txparam(0x02)
        let p := senderSlot(s)
        // a gate admission: burn the nullifier, admit the sender (frame 1 passed, so the proof was valid)
        if eq(frameparam(0x04, 1), PROOF_DATA()) {
          sstore(slotIn(framedataload(256, 1), 8), 1)
          sstore(add(p, 3), 1)
        }
        rollIfDue(p)
        sstore(add(p, 1), add(sload(add(p, 1)), txparam(0x06)))
        stop()
      }

      function rollIfDue(p) {
        if iszero(lt(timestamp(), add(sload(add(p, 2)), sload(add(BASE(), 1))))) {
          sstore(add(p, 1), 0)
          sstore(add(p, 2), timestamp())
        }
      }

      function onlyOwner() { req(eq(caller(), sload(BASE())), 0x72) }
      function ret(v) { mstore(0, v) return(0, 32) }
      function arg(i) -> v { v := calldataload(add(4, mul(32, i))) }

      // ---------------------------------------------------------------- dispatch
      if eq(caller(), 0xaa) {
        switch frameparam(0x02, txparam(0x0a))
        case 1 { verifyPayment() }
        default { record() }
      }
      if iszero(calldatasize()) { stop() }   // funding
      switch shr(224, calldataload(0))
      case 0x36db43b5 { onlyOwner() sstore(senderSlot(addr(arg(0))), arg(1)) stop() }       // setLimit(sender, limit)
      case 0x995284b1 { onlyOwner() sstore(add(BASE(), 3), arg(0)) stop() }                 // setDefaultLimit
      case 0x710e5d2f { onlyOwner() sstore(add(BASE(), 2), arg(0)) stop() }                 // setMaxFee
      case 0x0f3a9f65 { onlyOwner() sstore(add(BASE(), 1), arg(0)) stop() }                 // setPeriod
      case 0x6fdca5e0 { onlyOwner() sstore(add(BASE(), 4), iszero(iszero(arg(0)))) stop() } // setOpen
      case 0x2f7667ff { onlyOwner() sstore(slotIn(addr(arg(0)), 7), iszero(iszero(arg(1)))) stop() } // allowLogic(logic, on)
      case 0x8cf20ab8 { onlyOwner() sstore(add(BASE(), 5), addr(arg(0))) sstore(add(BASE(), 6), arg(1)) stop() } // setGate(verifier, root)
      case 0xf2fde38b { onlyOwner() sstore(BASE(), addr(arg(0))) stop() }                   // transferOwnership
      case 0xf3fef3a3 { onlyOwner() req(call(gas(), addr(arg(0)), arg(1), 0, 0, 0, 0), 0x74) stop() } // withdraw(to, amount)
      // Staking (ERC-8421 registry, keyed by msg.sender = this sponsor). The policy reads the sponsor's own global settings,
      // which the alternative mempool lets only a staked payer do; stake also raises the validation budget for a proof.
      case 0xc7e55f3e {                                                                     // stake(registry, delay) payable
        onlyOwner()
        mstore(0, shl(224, 0x0396cb60)) mstore(4, and(arg(1), 0xffffffff))
        req(call(gas(), addr(arg(0)), callvalue(), 0, 36, 0, 0), 0x75)
        stop()
      }
      case 0x4a1ce599 {                                                                     // unlockStake(registry)
        onlyOwner()
        mstore(0, shl(224, 0xbb9fe6bf))
        req(call(gas(), addr(arg(0)), 0, 0, 4, 0, 0), 0x75)
        stop()
      }
      case 0xb36f9705 {                                                                     // withdrawStake(registry, to)
        onlyOwner()
        mstore(0, shl(224, 0xc23a5cea)) mstore(4, addr(arg(1)))
        req(call(gas(), addr(arg(0)), 0, 0, 36, 0, 0), 0x75)
        stop()
      }
      case 0x14198ab4 { rollIfDue(senderSlot(addr(arg(0)))) stop() }                        // roll(sender): anyone
      case 0x546a2ca4 { ret(sload(senderSlot(addr(arg(0))))) }                              // limitOf (explicit)
      case 0x8ea91f7a { ret(sload(add(senderSlot(addr(arg(0))), 1))) }                      // spentOf
      case 0x76c8a418 { ret(sload(add(senderSlot(addr(arg(0))), 2))) }                      // periodStartOf
      case 0x0020d939 { ret(sload(add(senderSlot(addr(arg(0))), 3))) }                      // admitted
      case 0xb130c916 { ret(sload(slotIn(addr(arg(0)), 7))) }                                // logicAllowed
      case 0x79f95ee9 { ret(sload(slotIn(arg(0), 8))) }                                      // nullifierUsed
      case 0x70bb640f { ret(externalNullifier()) }
      case 0x8da5cb5b { ret(sload(BASE())) }
      case 0xef78d4fd { ret(sload(add(BASE(), 1))) }
      case 0x01f59d16 { ret(sload(add(BASE(), 2))) }
      case 0xe26b013b { ret(sload(add(BASE(), 3))) }
      case 0xfcfff16f { ret(sload(add(BASE(), 4))) }
      case 0x7f36476e { ret(sload(add(BASE(), 5))) }
      case 0x052a3e0d { ret(sload(add(BASE(), 6))) }
      default { fail(0x73) }
    }
  }
}
