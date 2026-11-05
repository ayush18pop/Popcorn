// Popcorn Core: the account code of every Popcorn rule contract (EIP-8141 frame transactions).
//
// A rule contract approves its own transaction when its condition is true. Core is the part that makes that safe to
// expose to anyone: it accepts exactly one frame layout, caps fees, lets each event fire once (EIP-8250 nonce key),
// locks re-entry into the action, and pays the reward to whoever actually paid for the transaction.
//
// Two payment modes:
//   mode 0 (rule pays)   : the rule contract's VERIFY frame approves execution and payment.
//   mode 1 (caller pays) : the rule contract's VERIFY frame approves execution only; a separate payer's VERIFY frame pays.
// Owner path: a transaction whose SENDER frame calls owner(bytes) is approved only with BOTH an ECDSA and a
// post-quantum WOTS+ signature, and runs the call on the logic with the owner flag set.
//
// One deployment per rule contract = this bytecode + 101 bytes of immutable arguments appended after the runtime
// (layout: LAYOUT.md). The INITCODE carries 84 more bytes (owner ecdsa, WOTS root, WOTS public seed) that the
// constructor writes to the namespaced owner slots; they are not part of the deployed code. Core has no admin and no
// upgrade path, stores nothing but the owner slots, and calls nothing but its logic contract (by DELEGATECALL; ecrecover
// by STATICCALL in the owner VERIFY).
//
// On-chain entry points are fixed by this bytecode: pop(bytes) (the SDK's trigger()), and the logic hooks
// __nonceKey, __condition, __action (ABI.md).
//
// Entry (dispatch at the bottom of the runtime):
//   caller == 0xaa (ENTRY_POINT)  -> verifyFrame()  : VERIFY frame 0 of the rule contract's own transaction
//                                                     (mode 1: verifySenderPays())
//   empty calldata                -> STOP           : plain ETH transfer (funding, incl. logic paying itself)
//   caller == address()           -> senderFrame()  : SENDER frame of the rule contract's OWN transaction only
//                                                     (tx.sender == rule contract, frame index 1 in mode 0 / 2 in mode 1)
//                                                     and once (transient lock); data owner(bytes) -> senderOwner()
//   anything else                 -> forward()      : an ordinary call, DELEGATECALLed to logic
// No frame opcode runs on the STOP/forward paths: TXPARAM/FRAMEPARAM halt outside a frame tx (SPEC.md section 1), and
// caller 0xaa / caller self can only happen inside a frame tx. forward() refuses the reserved selectors (only Core may
// call the hooks) and refuses while __action runs (the SENDER lock), so a forwarded call can never run inside an action.
//
// Opcode bytes, stack orders and param ids: SPEC.md sections 1-5. Reserved ABI: ABI.md.
// Every failed check reverts with a 32-byte error code (table in LAYOUT.md); a reverted VERIFY frame makes the
// transaction invalid, so nobody pays.
object "PopcornCore" {
  code {
    // initcode = this object ++ 101 args ++ 84 owner bytes. Deployed code = runtime ++ the 101 args (owner bytes are not kept).
    let rt := datasize("runtime")
    if iszero(eq(codesize(), add(datasize("PopcornCore"), 185))) { revert(0, 0) } // args must be exactly 101 + 84 bytes
    datacopy(0, dataoffset("runtime"), rt)
    codecopy(rt, datasize("PopcornCore"), 101)
    if iszero(extcodesize(shr(96, mload(rt)))) { revert(0, 0) }                    // logic must have code
    if gt(byte(0, mload(add(rt, 20))), 1) { revert(0, 0) }                         // mode must be 0 or 1
    // owner init: ecdsa (20) ++ wotsRoot (32) ++ wotsPubSeed (32). All zero = no owner (the owner path is off).
    let o := add(rt, 101)
    codecopy(o, add(datasize("PopcornCore"), 101), 84)
    let ownerEcdsa := shr(96, mload(o))
    let ownerRoot := mload(add(o, 20))
    let ownerSeed := mload(add(o, 52))
    switch ownerEcdsa
    case 0 { if or(ownerRoot, ownerSeed) { revert(0, 0) } }                       // no owner: root and seed must be zero too
    default {
      if or(iszero(ownerRoot), iszero(ownerSeed)) { revert(0, 0) }                 // owner: root and seed must be set
      // slot 0 = ecdsa | wotsIndex << 160 (index 0), slot 1 = wotsRoot, slot 2 = wotsPubSeed (non-zero: later updates cost no new-slot state gas)
      let base := 0x6c5153798c380854dc793bae6a86335313b83f008f4ecf20cd663a8aa18e7c27 // keccak256("popcorn.core.owner")
      sstore(base, ownerEcdsa)
      sstore(add(base, 1), ownerRoot)
      sstore(add(base, 2), ownerSeed)
    }
    return(0, add(rt, 101))
  }

  object "runtime" {
    code {
      // ---------------------------------------------------------------- EIP-8141 opcodes
      function txparam(id) -> v { v := verbatim_1i_1o(hex"b0", id) }
      function frameparam(param, idx) -> v { v := verbatim_2i_1o(hex"b3", idx, param) }   // idx on top
      function framedataload(off, idx) -> v { v := verbatim_2i_1o(hex"b1", off, idx) }    // offset on top
      function framedatacopy(mem, off, len, idx) { verbatim_4i_0o(hex"b2", mem, off, len, idx) }
      function approve(scope) { verbatim_3i_0o(hex"aa", 0, 0, scope) }                    // ends the frame
      function sigparam(param, idx) -> v { v := verbatim_2i_1o(hex"b4", idx, param) }      // idx on top
      function sigdatacopy(mem, off, len, idx) { verbatim_4i_0o(hex"b5", mem, off, len, idx) } // ARBITRARY entries only

      // ---------------------------------------------------------------- constants
      function SEL_POP() -> s { s := 0xd9292504 }          // pop(bytes)
      function SEL_NONCE_KEY() -> s { s := 0x97031c8c }    // __nonceKey(bytes)
      function SEL_CONDITION() -> s { s := 0x05f661f0 }    // __condition(bytes,bytes)
      function SEL_ACTION() -> s { s := 0x6019566d }       // __action(bytes,address)
      function NONCE_KEY_GAS() -> g { g := 10000 }         // fixed gas for __nonceKey
      function MANDATORY_GAS() -> g { g := 12950 }         // 12,000 intrinsic + 2 frames x 475 (no sigs, no value, no roots); mode 0 only
      function FLOOR_PER_BYTE() -> g { g := 64 }           // EIP-7976 floor: 4 tokens/byte x 16 gas/token
      function NONCE_RLP_BYTES() -> n { n := 35 }          // max len(rlp([key]) ++ rlp(0)) = 34 + 1 for one key <= 32 bytes
      function VERIFY_FIXED_GAS() -> g { g := 7000 }      // VERIFY gas besides the two calls (measured, LAYOUT.md "VERIFY floor")
      function LOCK_SLOT() -> s { s := 0x9dd81f995770cdac1e5604925d6a5e0e08886ca48a9ea18085a511ab38ae2d13 } // keccak256("popcorn.core.lock"), transient

      // ---------------------------------------------------------------- owner path constants (LAYOUT.md "OWNER")
      function SEL_OWNER() -> s { s := 0xbd27b241 }        // owner(bytes): the owner call frame
      function SEL_OWNER_BUMP() -> s { s := 0x91b5d060 }   // ownerBump(): the frame before it, spends the WOTS leaf
      function SEL_FINALIZE() -> s { s := 0x13077cfd }     // ownerFinalizeRotation(): the one owner call verified against the PENDING keys (slots +3..+5)
      function ECDSA_N_HALF() -> n { n := 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 } // secp256k1 n / 2: signatures must be low-s
      function OWNER_KEY() -> k { k := 0x7359ba52ecb8339ef831f17cc090648772bae5bfd6b471cb80453e37c92f8c5c } // keccak256("popcorn.owner.key"): the owner txs' nonce key
      function OWNER_BASE() -> s { s := 0x6c5153798c380854dc793bae6a86335313b83f008f4ecf20cd663a8aa18e7c27 } // keccak256("popcorn.core.owner"): +0 ecdsa|wotsIndex<<160, +1 wotsRoot, +2 wotsPubSeed
      function OWNER_FLAG() -> s { s := 0x4257847a835ea5fd0672322af0942e7be8da7acf8d7dedb7dd4ccbeeb6bdf7bf } // keccak256("popcorn.core.ownercall"), transient: 1 while Core runs an owner call
      function ADDR_MASK() -> m { m := 0xffffffffffffffffffffffffffffffffffffffff }
      function OWNER_MAX_VERIFY_GAS() -> g { g := 400000 }   // owner-signed, so only a sanity ceiling (the rule contract/payer must cover max_cost)
      function OWNER_MIN_BUMP_GAS() -> g { g := 30000 }      // the bump frame (cold SLOAD + SSTORE ~ 8,000) must not run out: a revealed leaf must be spent
      function OWNER_MAX_BUMP_GAS() -> g { g := 100000 }
      function OWNER_MAX_SENDER_GAS() -> g { g := 2000000 }
      function OWNER_MAX_STATE_GAS() -> g { g := 600000 }    // ~6 fresh slots
      function OWNER_MAX_CALL() -> n { n := 1024 }           // bytes of the inner call
      function OWNER_MANDATORY_GAS() -> g { g := 13625 }     // mode 0: 12,000 + 3 frames x 475 + 2 ARBITRARY signatures x 100
      function OWNER_NONCE_RLP_BYTES() -> n { n := 43 }      // rlp([32-byte key]) 34 + rlp(seq <= 8 bytes) 9
      function ECDSA_SIG_LEN() -> n { n := 65 }              // entry bytes: r (32) ++ s (32) ++ v (1, 27 or 28)
      function WOTS_ENTRY_LEN() -> n { n := 2496 }           // entry bytes: leaf (32, big-endian) ++ 67 chain values ++ 10 path nodes
      function WOTS_LEAVES() -> n { n := 1024 }              // height-10 tree

      // ---------------------------------------------------------------- immutable args (LAYOUT.md)
      // Copied from the code tail into scratch word 0x00; nothing else lives there.
      function arg(off, nbytes) -> v {
        codecopy(0, add(datasize("runtime"), off), 32)
        v := shr(sub(256, mul(8, nbytes)), mload(0))
      }
      function logic() -> v { v := arg(0, 20) }
      function mode() -> v { v := arg(20, 1) }                 // 0 rule-pays, 1 caller-pays; deploy rejects others
      function capMaxFee() -> v { v := arg(21, 16) }           // mode 0 only (mode 1: the payer pays, unused)
      function capPriorityFee() -> v { v := arg(37, 16) }      // mode 0 only
      function capGasPerFrame() -> v { v := arg(53, 8) }       // frame 0 limit <= it; SENDER frame limit == it
      function capStateGasPerFrame() -> v { v := arg(61, 8) }  // SENDER frame state limit == it; frame 0 state == 0
      // arg(69, 20) = verifier: reserved, unused by Core
      function conditionGas() -> v { v := arg(89, 4) }
      function maxVerifyDataLength() -> v { v := arg(93, 4) }  // frame 0 data bytes
      function maxPopArgsLength() -> v { v := arg(97, 4) }     // popArgs bytes

      // ---------------------------------------------------------------- helpers
      function req(ok, code) { if iszero(ok) { mstore(0, code) revert(0, 32) } }
      function ceil32(x) -> y { y := and(add(x, 31), not(31)) }
      // ABI padding of `len` bytes is zero iff the word holding the last byte, shifted left past the data, is 0.
      // (len % 32 == 0: that word starts at the end of the data, reads as 0.)
      function paddingClean(lastWord, len) -> ok { ok := iszero(shl(mul(8, and(len, 31)), lastWord)) }
      // Smallest frame 0 execution limit at which __nonceKey can use all NONCE_KEY_GAS and __condition still gets all
      // of conditionGas (DELEGATECALL forwards at most 63/64 of what is left, hence + conditionGas / 63).
      function verifyFloor(n0, n1) -> g {
        g := add(add(NONCE_KEY_GAS(), conditionGas()), add(div(conditionGas(), 63), add(VERIFY_FIXED_GAS(), add(n0, n1))))
      }

      // ================================================================ VERIFY (frame 0)
      // Memory: 0x00 scratch (args), 0x20 return word, 0x80.. __nonceKey calldata, then __condition calldata.
      function verifyFrame() {
        if eq(mode(), 1) { verifySenderPays() }                          // APPROVE(2) ends the frame, never returns
        if eq(txparam(0x09), 3) { if eq(shr(224, framedataload(0, 1)), SEL_OWNER_BUMP()) { verifyOwner() } } // the owner path (never returns)
        // 0. Mode
        req(eq(mode(), 0), 0x01)                                         // rule-pays (mode 1 dispatched above)

        // 1. Frame shape
        req(eq(txparam(0x0a), 0), 0x02)                                  // executing frame is frame 0
        req(eq(frameparam(0x02, 0), 1), 0x03)                            // frame 0 mode is VERIFY (not DEFAULT)
        req(eq(txparam(0x02), address()), 0x04)                          // tx.sender is this rule contract
        req(eq(txparam(0x09), 2), 0x05)                                  // exactly 2 frames
        req(eq(frameparam(0x00, 0), address()), 0x06)                    // frame 0 target is self
        req(eq(frameparam(0x03, 0), 3), 0x07)                            // frame 0 flags = 3 (may approve exec+payment)
        req(eq(frameparam(0x02, 1), 2), 0x08)                            // frame 1 mode is SENDER
        req(eq(frameparam(0x00, 1), address()), 0x09)                    // frame 1 target is self
        req(eq(frameparam(0x03, 1), 0), 0x0a)                            // frame 1 flags = 0
        req(eq(txparam(0x0e), 1), 0x0b)                                  // exactly one nonce key
        req(eq(txparam(0x0b), 0), 0x0c)                                  // no signatures (nothing for the rule contract to pay for)
        req(eq(txparam(0x07), 0), 0x0d)                                  // no blobs
        req(eq(txparam(0x11), 0), 0x23)                                  // no recent-root references 
        let n0 := frameparam(0x04, 0)                                    // VERIFY data (verifyData) length
        let n1 := frameparam(0x04, 1)                                    // SENDER data length
        let len := framedataload(36, 1)                                  // popArgs length word
        req(iszero(gt(n0, maxVerifyDataLength())), 0x24)                 // verifyData length <= cap
        req(eq(shr(224, framedataload(0, 1)), SEL_POP()), 0x0e)          // SENDER data starts with pop(bytes)
        req(eq(framedataload(4, 1), 0x20), 0x0f)                         // popArgs offset word is 0x20
        req(lt(len, n1), 0x10)                                           // popArgs length is inside the data (no overflow below)
        req(eq(n1, add(68, ceil32(len))), 0x11)                          // data = 4 + 32 + 32 + ceil32(len), nothing trailing
        req(iszero(gt(len, maxPopArgsLength())), 0x25)                   // popArgs length <= cap
        req(paddingClean(framedataload(add(68, and(len, not(31))), 1), len), 0x26) // popArgs ABI padding is zero

        // 2. Fee and gas caps. Frame 1's limits are pinned: a smaller one would let anyone starve the action
        //    while the nonce key is consumed and the rule contract pays. Unused gas is refunded, so pinning costs nothing.
        req(iszero(gt(txparam(0x04), capMaxFee())), 0x12)                // max_fee_per_gas <= cap
        req(iszero(gt(txparam(0x03), capPriorityFee())), 0x13)           // max_priority_fee_per_gas <= cap
        req(iszero(gt(frameparam(0x01, 0), capGasPerFrame())), 0x14)     // frame 0 execution gas limit <= cap
        req(iszero(lt(frameparam(0x01, 0), verifyFloor(n0, n1))), 0x27)  // frame 0 execution gas limit >= floor (no starved condition)
        req(eq(frameparam(0x01, 1), capGasPerFrame()), 0x15)             // frame 1 execution gas limit == cap
        req(iszero(frameparam(0x09, 0)), 0x16)                           // frame 0 state gas limit == 0 (VERIFY is static)
        req(eq(frameparam(0x09, 1), capStateGasPerFrame()), 0x17)        // frame 1 state gas limit == cap
        req(iszero(frameparam(0x08, 0)), 0x18)                           // frame 0 value = 0
        req(iszero(frameparam(0x08, 1)), 0x19)                           // frame 1 value = 0 (a pop never moves the rule contract's ETH)
        let limits := add(add(frameparam(0x01, 0), frameparam(0x01, 1)), add(frameparam(0x09, 0), frameparam(0x09, 1)))
        let gasBound := add(add(limits, MANDATORY_GAS()), mul(FLOOR_PER_BYTE(), add(add(n0, n1), NONCE_RLP_BYTES())))
        req(iszero(gt(txparam(0x06), mul(txparam(0x04), gasBound))), 0x1a) // max_cost <= max_fee * (4 limits + 12,950 + 64*(n0+n1+35))

        // 3. Exactly once: nonce key = __nonceKey(popArgs), sequence 0
        let p := 0x80
        mstore(p, shl(224, SEL_NONCE_KEY()))
        framedatacopy(add(p, 4), 4, sub(n1, 4), 1)                       // calldata = selector ++ SENDER data[4:] (= abi.encode(popArgs))
        req(delegatecall(NONCE_KEY_GAS(), logic(), p, n1, 0x20, 0x20), 0x1b) // __nonceKey succeeded
        req(eq(returndatasize(), 32), 0x1c)                              // returned exactly one word
        let key := mload(0x20)
        req(iszero(iszero(key)), 0x1d)                                   // key != 0 (key 0 selects the account nonce)
        req(eq(txparam(0x10), key), 0x1e)                                // the tx's nonce key == key
        req(iszero(txparam(0x01)), 0x1f)                                 // nonce_seq == 0 (each key pops once)

        // 4. Condition: __condition(popArgs, verifyData), verifyData = frame 0 data
        let q := add(p, ceil32(n1))                                      // fresh (zeroed) memory
        mstore(q, shl(224, SEL_CONDITION()))
        mstore(add(q, 4), 0x40)                                          // offset of popArgs
        mstore(add(q, 36), add(0x40, sub(n1, 36)))                       // offset of verifyData
        framedatacopy(add(q, 68), 36, sub(n1, 36), 1)                    // popArgs length word + padded bytes
        mstore(add(q, add(n1, 32)), n0)                                  // verifyData length word
        framedatacopy(add(q, add(n1, 64)), 0, n0, 0)                     // verifyData bytes (padding stays zero)
        req(delegatecall(conditionGas(), logic(), q, add(add(n1, 64), ceil32(n0)), 0x20, 0x20), 0x20) // __condition succeeded
        req(eq(returndatasize(), 32), 0x21)                              // returned exactly one word
        req(eq(mload(0x20), 1), 0x22)                                    // and it is exactly 1 (true)

        // 5. Approve execution + payment. Ends the frame.
        approve(3)
      }

      // ================================================================ VERIFY, caller-pays (mode 1)
      // Shape: [0] VERIFY flags 2 -> rule contract (this frame; approves EXECUTION only)
      //        [1] VERIFY flags 1 -> payer != rule contract (the payer's own code / EOA default code approves PAYMENT)
      //        [2] SENDER flags 0 -> rule contract, pop(popArgs)
      //        [3] optional DEFAULT flags 0 -> target != rule contract, value 0 (e.g. the caller's own follow-up)
      // The rule contract never approves payment, so no APPROVE here can debit it: fee caps and the debit bound (0x12, 0x13,
      // 0x1a) do not apply; the payer picks fees and pays them. Signatures are the payer's business (an EOA payer needs
      // signatures[1]); Core does not constrain them. Everything that protects the rule contract's nonce key and action stays:
      // the SENDER frame's limits are pinned (a starved action would still burn the key), VERIFY is static, the floor
      // (0x27) feeds the condition, exactly one key at seq 0, the payer's frame cannot target the rule contract, and no frame
      // other than frame 2 runs as the rule contract (frame 3 is DEFAULT: caller 0xaa, no sender authority).
      // Memory: as verifyFrame, with frame 2 as the SENDER frame.
      function verifySenderPays() {
        // 1. Frame shape
        req(eq(txparam(0x0a), 0), 0x02)                                  // executing frame is frame 0
        req(eq(frameparam(0x02, 0), 1), 0x03)                            // frame 0 mode is VERIFY
        req(eq(txparam(0x02), address()), 0x04)                          // tx.sender is this rule contract
        let nf := txparam(0x09)
        req(or(eq(nf, 3), eq(nf, 4)), 0x40)                              // 3 frames, or 4 with a DEFAULT tail
        if eq(nf, 4) { if eq(shr(224, framedataload(0, 2)), SEL_OWNER_BUMP()) { verifyOwner() } } // the owner path (never returns)
        req(eq(frameparam(0x00, 0), address()), 0x06)                    // frame 0 target is self
        req(eq(frameparam(0x03, 0), 2), 0x41)                            // frame 0 flags = 2 (may approve execution only)
        req(eq(frameparam(0x02, 1), 1), 0x42)                            // frame 1 (payer) mode is VERIFY
        req(iszero(eq(frameparam(0x00, 1), address())), 0x43)            // frame 1 target (the payer) is not the rule contract
        req(eq(frameparam(0x03, 1), 1), 0x44)                            // frame 1 flags = 1 (may approve payment only)
        req(eq(frameparam(0x02, 2), 2), 0x45)                            // frame 2 mode is SENDER
        req(eq(frameparam(0x00, 2), address()), 0x46)                    // frame 2 target is self
        req(eq(frameparam(0x03, 2), 0), 0x47)                            // frame 2 flags = 0 (no atomic batch)
        if eq(nf, 4) {
          req(eq(frameparam(0x02, 3), 0), 0x48)                          // frame 3 mode is DEFAULT (never SENDER: it would act as the rule contract)
          req(iszero(eq(frameparam(0x00, 3), address())), 0x49)          // frame 3 target is not the rule contract
          req(eq(frameparam(0x03, 3), 0), 0x4a)                          // frame 3 flags = 0
          req(iszero(frameparam(0x08, 3)), 0x4b)                         // frame 3 value = 0
        }
        req(eq(txparam(0x0e), 1), 0x0b)                                  // exactly one nonce key
        req(eq(txparam(0x07), 0), 0x0d)                                  // no blobs
        req(eq(txparam(0x11), 0), 0x23)                                  // no recent-root references
        let n0 := frameparam(0x04, 0)                                    // VERIFY data (verifyData) length
        let n1 := frameparam(0x04, 2)                                    // SENDER (frame 2) data length
        let len := framedataload(36, 2)                                  // popArgs length word
        req(iszero(gt(n0, maxVerifyDataLength())), 0x24)                 // verifyData length <= cap
        req(eq(shr(224, framedataload(0, 2)), SEL_POP()), 0x0e)          // SENDER data starts with pop(bytes)
        req(eq(framedataload(4, 2), 0x20), 0x0f)                         // popArgs offset word is 0x20
        req(lt(len, n1), 0x10)                                           // popArgs length is inside the data
        req(eq(n1, add(68, ceil32(len))), 0x11)                          // canonical, nothing trailing
        req(iszero(gt(len, maxPopArgsLength())), 0x25)                   // popArgs length <= cap
        req(paddingClean(framedataload(add(68, and(len, not(31))), 2), len), 0x26) // popArgs ABI padding is zero

        // 2. Gas limits (no fee caps: the payer pays). SENDER limits pinned so nobody can starve the action while the
        //    rule contract's key is consumed.
        req(iszero(gt(frameparam(0x01, 0), capGasPerFrame())), 0x14)     // frame 0 execution gas limit <= cap
        req(iszero(lt(frameparam(0x01, 0), verifyFloor(n0, n1))), 0x27)  // frame 0 execution gas limit >= floor
        req(eq(frameparam(0x01, 2), capGasPerFrame()), 0x15)             // SENDER execution gas limit == cap
        req(iszero(frameparam(0x09, 0)), 0x16)                           // frame 0 state gas limit == 0
        req(eq(frameparam(0x09, 2), capStateGasPerFrame()), 0x17)        // SENDER state gas limit == cap
        req(iszero(frameparam(0x08, 0)), 0x18)                           // frame 0 value = 0
        req(iszero(frameparam(0x08, 2)), 0x19)                           // SENDER value = 0 (a pop never moves the rule contract's ETH)

        // 3. Exactly once: nonce key = __nonceKey(popArgs), sequence 0 (consumed at the payer's APPROVE)
        let p := 0x80
        mstore(p, shl(224, SEL_NONCE_KEY()))
        framedatacopy(add(p, 4), 4, sub(n1, 4), 2)
        req(delegatecall(NONCE_KEY_GAS(), logic(), p, n1, 0x20, 0x20), 0x1b)
        req(eq(returndatasize(), 32), 0x1c)
        let key := mload(0x20)
        req(iszero(iszero(key)), 0x1d)
        req(eq(txparam(0x10), key), 0x1e)
        req(iszero(txparam(0x01)), 0x1f)

        // 4. Condition: __condition(popArgs, verifyData)
        let q := add(p, ceil32(n1))
        mstore(q, shl(224, SEL_CONDITION()))
        mstore(add(q, 4), 0x40)
        mstore(add(q, 36), add(0x40, sub(n1, 36)))
        framedatacopy(add(q, 68), 36, sub(n1, 36), 2)
        mstore(add(q, add(n1, 32)), n0)
        framedatacopy(add(q, add(n1, 64)), 0, n0, 0)
        req(delegatecall(conditionGas(), logic(), q, add(add(n1, 64), ceil32(n0)), 0x20, 0x20), 0x20)
        req(eq(returndatasize(), 32), 0x21)
        req(eq(mload(0x20), 1), 0x22)

        // 5. Approve execution only. Ends the frame. Payment is frame 1's (the payer's) decision.
        approve(2)
      }

      // ================================================================ SENDER (frame 1; frame 2 in mode 1)
      function senderFrame() {
        req(eq(frameparam(0x02, txparam(0x0a)), 2), 0x30)                // executing frame is a SENDER frame
        req(eq(txparam(0x02), address()), 0x3b)                          // tx.sender is this rule contract (not another account's SENDER frame)
        let sel := shr(224, calldataload(0))
        let ownerCall := eq(sel, SEL_OWNER())
        req(eq(txparam(0x0a), add(add(mode(), 1), ownerCall)), 0x3c)     // executing frame is the pop's / the owner bump's SENDER frame: 1 (mode 0) / 2 (mode 1); the owner call is one later (v1.4)
        req(lt(mode(), 2), 0x31)                                         // mode 0 or 1 (deploy guarantees it)
        req(iszero(tload(LOCK_SLOT())), 0x37)                            // not re-entered from __action (TLOAD: SENDER frames only)
        if eq(sel, SEL_OWNER_BUMP()) { senderOwnerBump() }               // spends the WOTS leaf (stops)
        tstore(LOCK_SLOT(), 1)
        if ownerCall { senderOwnerCall() }                               // the owner call (returns or reverts); a pop continues below
        let n := calldatasize()
        let len := calldataload(36)
        req(eq(shr(224, calldataload(0)), SEL_POP()), 0x32)              // same encoding rules as checks 0x0e-0x11, 0x26
        req(eq(calldataload(4), 0x20), 0x33)
        req(lt(len, n), 0x34)
        req(eq(n, add(68, ceil32(len))), 0x35)
        req(paddingClean(calldataload(add(68, and(len, not(31)))), len), 0x36)
        let payer := address()                                           // rule-pays: the rule contract paid
        if mode() { payer := frameparam(0x00, 1) }                       // caller-pays: frame 1's target paid (VERIFY checked 0x42-0x44)
        let lg := logic()
        mstore(0, shl(224, SEL_ACTION()))
        mstore(4, 0x40)                                                  // offset of popArgs
        mstore(36, payer)                                                // payer
        calldatacopy(68, 36, sub(n, 36))                                 // popArgs length word + padded bytes
        let ok := delegatecall(gas(), lg, 0, add(n, 32), 0, 0)
        returndatacopy(0, 0, returndatasize())
        if iszero(ok) { revert(0, returndatasize()) }                    // bubble the revert verbatim (the lock reverts with it)
        tstore(LOCK_SLOT(), 0)
        return(0, returndatasize())
      }


      // ================================================================ OWNER: VERIFY and SENDER
      // Shape, mode 0: [0] VERIFY flags 3 -> rule contract (approves execution AND payment: the rule contract pays),
      //                [1] SENDER flags 0 -> rule contract, data ownerBump()   (spends the WOTS leaf),
      //                [2] SENDER flags 0 -> rule contract, data owner(bytes call).
      // Shape, mode 1: [0] VERIFY flags 2 -> rule contract, [1] VERIFY flags 1 -> payer (!= rule contract), [2] bump, [3] owner call.
      // The bump is its OWN frame so that it commits even if the owner call reverts (frames commit independently): the
      // call's failure is then visible as a reverted frame (simulate, receipt) while the leaf stays spent.
      // Nonce key OWNER_KEY with the ordinary sequence (the protocol checks and bumps it). Signatures: the LAST TWO entries,
      //   [n-2] ARBITRARY, empty msg, 65 bytes  r ++ s ++ v      ECDSA over the sig hash (TXPARAM 0x08), ecrecover == owner.ecdsa
      //   [n-1] ARBITRARY, empty msg, 2496 bytes leaf ++ WOTS+ signature ++ Merkle path    verifies against owner.wotsRoot
      // Both are elided from the sig hash (empty msg), so both sign the same hash h, which covers every other byte of the tx
      // (calls, limits, fees, nonce key and sequence, the other signature entries' metadata). The tree leaf must be >=
      // owner.wotsIndex; the bump sets wotsIndex = leaf + 1. Memory: 0x00-0x7f scratch (ecrecover input, hash chains),
      // 0x80.. the WOTS signature. Every arg() read happens before the hash chains (they use scratch 0x00/0x20).
      function verifyOwner() {
        let m := mode()
        let b := add(m, 1)                                               // bump frame index
        let s := add(m, 2)                                               // owner call frame index
        // 1. Frame shape
        req(eq(txparam(0x0a), 0), 0x02)                                  // executing frame is frame 0
        req(eq(frameparam(0x02, 0), 1), 0x03)                            // frame 0 mode is VERIFY
        req(eq(txparam(0x02), address()), 0x04)                          // tx.sender is this rule contract
        req(eq(txparam(0x09), add(m, 3)), 0x50)                          // mode 0: 3 frames; mode 1: 4 frames (no tail)
        req(eq(frameparam(0x00, 0), address()), 0x06)                    // frame 0 target is self
        req(eq(frameparam(0x03, 0), sub(3, m)), 0x07)                    // frame 0 flags: 3 (mode 0, pays) / 2 (mode 1, execution only)
        if m {
          req(eq(frameparam(0x02, 1), 1), 0x42)                          // payer frame is VERIFY
          req(iszero(eq(frameparam(0x00, 1), address())), 0x43)          // payer is not the rule contract
          req(eq(frameparam(0x03, 1), 1), 0x44)                          // payer frame flags 1 (payment only)
        }
        req(eq(frameparam(0x02, b), 2), 0x08)                            // bump frame is SENDER
        req(eq(frameparam(0x00, b), address()), 0x09)                    // ... target self
        req(eq(frameparam(0x03, b), 0), 0x0a)                            // ... flags 0 (not atomic with the call: it must commit alone)
        req(eq(frameparam(0x02, s), 2), 0x66)                            // owner call frame is SENDER
        req(eq(frameparam(0x00, s), address()), 0x67)                    // ... target self
        req(eq(frameparam(0x03, s), 0), 0x68)                            // ... flags 0
        req(eq(txparam(0x0e), 1), 0x0b)                                  // exactly one nonce key
        req(eq(txparam(0x10), OWNER_KEY()), 0x51)                        // ... and it is OWNER_KEY (ordinary sequence)
        req(eq(txparam(0x07), 0), 0x0d)                                  // no blobs
        req(eq(txparam(0x11), 0), 0x23)                                  // no recent-root references
        req(iszero(frameparam(0x04, 0)), 0x5e)                           // VERIFY data is empty (nothing there is read)
        // 2. Bump data: exactly the 4-byte selector. Call data: owner(bytes call), canonical, 4 <= len <= cap, selector not reserved
        req(eq(frameparam(0x04, b), 4), 0x65)                            // bump data is 4 bytes
        req(eq(shr(224, framedataload(0, b)), SEL_OWNER_BUMP()), 0x65)   // ... the bump selector
        let n1 := frameparam(0x04, s)
        let len := framedataload(36, s)
        req(eq(shr(224, framedataload(0, s)), SEL_OWNER()), 0x69)        // call data starts with owner(bytes)
        req(eq(framedataload(4, s), 0x20), 0x0f)                         // offset word is 0x20
        req(lt(len, n1), 0x10)                                           // length is inside the data
        req(eq(n1, add(68, ceil32(len))), 0x11)                          // canonical, nothing trailing
        req(paddingClean(framedataload(add(68, and(len, not(31))), s), len), 0x26) // zero padding
        req(iszero(gt(len, OWNER_MAX_CALL())), 0x53)                     // call fits the cap
        req(iszero(lt(len, 4)), 0x54)                                    // call has a selector
        let csel := shr(224, framedataload(68, s))
        req(iszero(or(or(or(eq(csel, SEL_NONCE_KEY()), eq(csel, SEL_CONDITION())), or(eq(csel, SEL_ACTION()), eq(csel, SEL_POP()))), or(eq(csel, SEL_OWNER()), eq(csel, SEL_OWNER_BUMP())))), 0x55) // no reserved selector
        // 3. Gas limits and fees. The owner signs all of them, so they are only bounded by sanity ceilings (and the fee caps in mode 0).
        req(iszero(gt(frameparam(0x01, 0), OWNER_MAX_VERIFY_GAS())), 0x14) // frame 0 execution limit <= ceiling
        req(iszero(lt(frameparam(0x01, b), OWNER_MIN_BUMP_GAS())), 0x56) // bump execution limit >= the minimum (a revealed leaf must get spent)
        req(iszero(gt(frameparam(0x01, b), OWNER_MAX_BUMP_GAS())), 0x56) // ... and <= its ceiling
        req(iszero(gt(frameparam(0x01, s), OWNER_MAX_SENDER_GAS())), 0x15) // call execution limit <= ceiling
        req(iszero(frameparam(0x09, 0)), 0x16)                           // frame 0 state limit == 0
        req(iszero(frameparam(0x09, b)), 0x17)                           // bump state limit == 0 (it writes an existing slot)
        req(iszero(gt(frameparam(0x09, s), OWNER_MAX_STATE_GAS())), 0x17) // call state limit <= ceiling
        req(iszero(frameparam(0x08, 0)), 0x18)                           // frame 0 value = 0
        req(iszero(frameparam(0x08, b)), 0x19)                           // bump value = 0
        req(iszero(frameparam(0x08, s)), 0x19)                           // call value = 0
        // 4. Signature entries: the last two (mode 1: the payer's entries, if any, come first)
        let ns := txparam(0x0b)
        req(iszero(lt(ns, 2)), 0x52)
        if iszero(m) { req(eq(ns, 2), 0x52) }                            // mode 0: exactly the two owner entries
        let ie := sub(ns, 2)
        let iw := sub(ns, 1)
        req(iszero(sigparam(0x01, ie)), 0x57)                            // ECDSA entry is ARBITRARY
        req(iszero(sigparam(0x02, ie)), 0x58)                            // ... with empty msg (its bytes are elided from the hash it signs)
        req(eq(sigparam(0x03, ie), ECDSA_SIG_LEN()), 0x59)               // ... exactly 65 bytes
        req(iszero(sigparam(0x01, iw)), 0x5a)                            // WOTS entry is ARBITRARY
        req(iszero(sigparam(0x02, iw)), 0x5b)                            // ... with empty msg
        req(eq(sigparam(0x03, iw), WOTS_ENTRY_LEN()), 0x5c)              // ... exactly leaf + signature + path
        // 5. Rule-pays: fee caps and the debit bound (mirror of 0x12, 0x13, 0x1a; two ARBITRARY signatures, 65 + 2,496 bytes)
        if iszero(m) {
          req(iszero(gt(txparam(0x04), capMaxFee())), 0x12)              // max_fee_per_gas <= cap
          req(iszero(gt(txparam(0x03), capPriorityFee())), 0x13)         // max_priority_fee_per_gas <= cap
          let limits := add(add(frameparam(0x01, 0), add(frameparam(0x01, 1), frameparam(0x01, 2))), add(frameparam(0x09, 1), frameparam(0x09, 2)))
          let bytes_ := add(add(add(n1, 4), add(ECDSA_SIG_LEN(), WOTS_ENTRY_LEN())), OWNER_NONCE_RLP_BYTES())
          let gasBound := add(add(limits, OWNER_MANDATORY_GAS()), mul(FLOOR_PER_BYTE(), bytes_))
          req(iszero(gt(txparam(0x06), mul(txparam(0x04), gasBound))), 0x1a) // max_cost <= max_fee * bound
        }
        // 6. Owner keys (own storage, no stake needed) and the two signatures
        // ownerFinalizeRotation() is verified against the pending keys (staged by ownerRotate, slots +3..+5), every other call
        // against the active keys: the old keys stay in force until a tx signed by the NEW keys lands (two-step rotation)
        let kb := OWNER_BASE()
        if eq(csel, SEL_FINALIZE()) { kb := add(kb, 3) }
        let st := sload(kb)
        let ecdsa := and(st, ADDR_MASK())
        req(iszero(iszero(ecdsa)), 0x5d)                                 // an owner (or, for finalize, a pending rotation) is configured
        let root := sload(add(kb, 1))
        let seed := sload(add(kb, 2))
        let h := txparam(0x08)                                           // the signature hash
        // ECDSA: ecrecover(h, v, r, s) == owner.ecdsa (precompile 1; v must be 27/28 or the call returns nothing -> 0 != ecdsa)
        mstore(0x00, h)
        mstore(0x20, 0)
        sigdatacopy(0x3f, 64, 1, ie)                                     // v: the entry's last byte, right-aligned in the word at 0x20
        sigdatacopy(0x40, 0, 64, ie)                                     // r ++ s
        req(or(eq(mload(0x20), 27), eq(mload(0x20), 28)), 0x6a)          // v is 27 or 28
        req(iszero(gt(mload(0x60), ECDSA_N_HALF())), 0x6a)               // s <= n/2: one encoding per signature (no malleable twin)
        mstore(0x80, 0)
        pop(staticcall(5000, 1, 0x00, 0x80, 0x80, 0x20))
        req(eq(mload(0x80), ecdsa), 0x5f)                                // signer recovered == owner.ecdsa (0 on failure, never equal)
        // WOTS+: leaf >= wotsIndex (spent leaves never verify again), leaf < 1024, then chains + Merkle path against the root
        sigdatacopy(0x40, 0, 32, iw)
        let leaf := mload(0x40)
        req(lt(leaf, WOTS_LEAVES()), 0x60)                               // leaf is in the tree
        req(iszero(lt(leaf, shr(160, st))), 0x61)                        // leaf >= owner.wotsIndex
        sigdatacopy(0x80, 32, 2464, iw)
        req(wotsVerify(root, seed, leaf, h), 0x62)
        // 7. Approve. Mode 0: execution + payment (the rule contract pays; the nonce key's sequence is consumed here). Mode 1:
        //    execution only; the payer's frame consumes the key.
        approve(sub(3, m))
      }

      // WOTS+ (w = 16, n = 32, keccak256, 67 chains) with a height-10 Merkle tree: pq-sig/yul/gen.ts (w = 16). The signature
      // (67 chain values, then 10 path nodes) sits at 0x80. Tweak T = pubSeed XOR (leaf << 16 | chain << 8 | step).
      function wotsVerify(root, seed, leaf, msg) -> ok {
        let base0 := xor(seed, shl(16, leaf))
        let csum := 0
        for { let i := 0 } lt(i, 64) { i := add(i, 1) } {
          let d := and(shr(sub(256, mul(4, add(i, 1))), msg), 15)
          csum := add(csum, sub(15, d))
          let ptr := add(0x80, shl(5, i))
          mstore(ptr, wotsChain(mload(ptr), xor(base0, shl(8, i)), d))
        }
        for { let j := 0 } lt(j, 3) { j := add(j, 1) } {
          let d := and(shr(mul(4, sub(2, j)), csum), 15)
          let i := add(64, j)
          let ptr := add(0x80, shl(5, i))
          mstore(ptr, wotsChain(mload(ptr), xor(base0, shl(8, i)), d))
        }
        let node := keccak256(0x80, 2144)                                // the 67 public chain ends -> leaf hash
        let path := add(0x80, 2144)
        for { let k := 0 } lt(k, 10) { k := add(k, 1) } {
          let sib := mload(add(path, shl(5, k)))
          switch and(shr(k, leaf), 1)
          case 0 { mstore(0, node) mstore(0x20, sib) }
          default { mstore(0, sib) mstore(0x20, node) }
          node := keccak256(0, 0x40)
        }
        ok := eq(node, root)
      }
      // Hash x from chain position `start` up to 15; tweak = base XOR step.
      function wotsChain(x, base, start) -> r {
        mstore(0x20, x)
        for { let st := start } lt(st, 15) { st := add(st, 1) } {
          mstore(0, xor(base, st))
          mstore(0x20, keccak256(0, 0x40))
        }
        r := mload(0x20)
      }

      // SENDER side of an owner tx, frame "bump" (index mode + 1). Reached from senderFrame after 0x30, 0x3b, 0x3c and the
      // lock check, so only in the rule contract's own approved tx, whose VERIFY ran verifyOwner (and so checked this frame's
      // data and the signatures). Sets wotsIndex = leaf + 1, keeping ecdsa. Needs no external call and no lock.
      function senderOwnerBump() {
        req(eq(calldatasize(), 4), 0x65)                                 // exactly the selector
        sigdatacopy(0x00, 0, 32, sub(txparam(0x0b), 1))                  // the WOTS entry's leaf (the last signature entry)
        let slot := OWNER_BASE()
        // the call frame (the next one) ownerFinalizeRotation() was verified against the pending keys: spend the leaf there
        if eq(shr(224, framedataload(68, add(txparam(0x0a), 1))), SEL_FINALIZE()) { slot := add(slot, 3) }
        sstore(slot, or(and(sload(slot), ADDR_MASK()), shl(160, add(mload(0x00), 1))))
        stop()
      }

      // SENDER side of an owner tx, frame "call" (index mode + 2): the inner call runs on the logic by DELEGATECALL with
      // the owner flag set (msg.sender in the logic is the rule contract; PopcornKernel.onlyOwnerCall checks the flag). The lock
      // is held, so no forwarded call or pop re-enters meanwhile. A failing call reverts this frame (revert data bubbled);
      // the bump frame before it has committed, so the leaf stays spent. It runs only if the bump frame succeeded.
      function senderOwnerCall() {
        req(eq(frameparam(0x05, sub(txparam(0x0a), 1)), 1), 0x63)        // the bump frame before this one succeeded
        let lg := logic()                                                // arg() uses scratch 0x00: read before the copy
        let n := calldatasize()
        let len := calldataload(36)                                      // VERIFY validated the encoding and len <= OWNER_MAX_CALL
        req(lt(len, n), 0x34)
        calldatacopy(0x80, 68, len)
        tstore(OWNER_FLAG(), 1)
        let ok := delegatecall(gas(), lg, 0x80, len, 0, 0)
        tstore(OWNER_FLAG(), 0)
        returndatacopy(0, 0, returndatasize())
        if iszero(ok) { revert(0, returndatasize()) }                    // bubble the revert verbatim (lock and flag revert with it)
        tstore(LOCK_SLOT(), 0)
        return(0, returndatasize())
      }

      // ================================================================ FORWARD (ordinary calls)
      // Any caller other than 0xaa and self: DELEGATECALL logic with the calldata, all gas, value kept (delegatecall
      // keeps CALLVALUE). No frame opcode; TLOAD is an ordinary opcode outside a frame tx.
      function forward() {
        req(iszero(lt(calldatasize(), 4)), 0x3a)                         // a selector is present
        let sel := shr(224, calldataload(0))
        req(iszero(or(or(or(eq(sel, SEL_NONCE_KEY()), eq(sel, SEL_CONDITION())), or(eq(sel, SEL_ACTION()), eq(sel, SEL_POP()))), or(eq(sel, SEL_OWNER()), eq(sel, SEL_OWNER_BUMP())))), 0x38) // reserved selectors: Core-only
        req(iszero(tload(LOCK_SLOT())), 0x39)                            // not while __action runs (no re-entry from a pop)
        let lg := logic()                                                // before the copy: arg() uses scratch 0x00
        calldatacopy(0, 0, calldatasize())
        let ok := delegatecall(gas(), lg, 0, calldatasize(), 0, 0)
        returndatacopy(0, 0, returndatasize())
        if iszero(ok) { revert(0, returndatasize()) }                    // bubble the revert verbatim
        return(0, returndatasize())
      }

      // ================================================================ dispatch
      if eq(caller(), 0xaa) { verifyFrame() revert(0, 0) }               // APPROVE ends the frame; never falls through
      if iszero(calldatasize()) { stop() }                               // plain ETH transfer (any other caller, incl. self): accept
      if eq(caller(), address()) { senderFrame() }                       // returns or reverts
      forward()                                                          // any other call
    }
  }
}
