// Nonce key of a trigger, computed the way Core computes it, without a frame tx.
//
// Core runs `DELEGATECALL(10,000 gas, logic, __nonceKey(triggerData))` in the rule contract's VERIFY frame (caller 0xaa). That
// cannot be reproduced with eth_call on the rule contract: Core does not run VERIFY outside a frame tx (TXPARAM halts), and
// ethrex has no state override (eth_call/debug_traceCall refuse it; measured). ethrex_simulateFrameTransaction
// needs the key already (wrong key -> Core 0x1e, no trace, no return data).
//
// So: a "shadow" creation eth_call from 0xaa whose initcode (1) SSTOREs the rule contract's values for the slots the logic
// reads, (2) DELEGATECALLs the logic's __nonceKey(triggerData) with Core's NONCE_KEY_GAS, (3) returns its return data.
// The slots are found with debug_traceCall + prestateTracer (storage read at the shadow address) and fetched with
// eth_getStorageAt from the rule contract, iterated until no new slot appears. msg.sender inside the logic is 0xaa as in
// VERIFY; other contracts' state is the real state. Differences from VERIFY: ADDRESS/SELFBALANCE are the shadow's
// (keys derived from them are not supported; pass `nonceKey`). The result is never trusted blindly: trigger()/canTrigger()
// always simulate the full trigger on ethrex, and a wrong key shows up as Core 0x1e NONCE_KEY_MISMATCH.
import { concat, encodeFunctionData, getContractAddress, numberToHex, pad, parseAbi, size, type Address, type Hex } from "viem";
import { NonceKeyUnavailable, RpcError } from "./errors.ts";
import { ENTRY_POINT } from "./types.ts";

export const coreLogicAbi = parseAbi([
  "function __nonceKey(bytes triggerData) view returns (uint256)",
  "function __condition(bytes triggerData, bytes verifyData) view returns (bool)",
  "function __action(bytes triggerData, address payer)",
]);

/** Minimal JSON-RPC surface the shadow needs (a viem client's `request` fits). */
export type RpcFn = <T>(method: string, params: unknown[]) => Promise<T>;

const h = (n: number, bytes: number): Hex => pad(numberToHex(n), { size: bytes });

/**
 * Shadow initcode: prefill ++ CODECOPY(calldata) ++ DELEGATECALL(gas, logic, calldata) ++ return/revert returndata.
 * Exported for tests.
 */
export function shadowInitcode(prefill: readonly (readonly [Hex, Hex])[], logic: Address, calldata: Hex, gas: number): Hex {
  const pre = prefill.map(([slot, val]) => concat(["0x7f", pad(val), "0x7f", pad(slot), "0x55"])); // PUSH32 v PUSH32 s SSTORE
  const P = pre.length * 67;
  const len = size(calldata);
  // body, offsets relative to its start (63 bytes):
  //  0 61 len  3 61 off  6 60 00  8 39                         CODECOPY(0, off, len)
  //  9 60 00  11 60 00  13 61 len  16 60 00  18 73 logic(20)    retLen 0, retOff 0, argsLen, argsOff 0, addr
  // 39 62 gas(3)  43 f4                                         DELEGATECALL
  // 44 3d 60 00 60 00 3e                                        RETURNDATACOPY(0, 0, rds)
  // 50 61 ok(2)  53 57                                          JUMPI(ok, success)
  // 54 3d 60 00 fd                                              REVERT(0, rds)
  // 58 5b 3d 60 00 f3                                           ok: RETURN(0, rds)
  const BODY = 63;
  if (P + BODY + len > 0xffff) throw new NonceKeyUnavailable("shadow initcode too large");
  const body = concat([
    "0x61", h(len, 2), "0x61", h(P + BODY, 2), "0x600039",
    "0x60006000", "0x61", h(len, 2), "0x6000", "0x73", logic,
    "0x62", h(gas, 3), "0xf4",
    "0x3d600060003e",
    "0x61", h(P + 58, 2), "0x57",
    "0x3d6000fd",
    "0x5b3d6000f3",
  ]);
  if (size(body) !== BODY) throw new Error(`shadow body is ${size(body)} bytes`);
  return concat([...pre, body, calldata]).toLowerCase() as Hex;
}

export interface ShadowResult {
  /** Return data of the delegatecall (or revert data when `ok` is false). */
  data: Hex;
  ok: boolean;
  /** Rule contract storage slots that were copied into the shadow. */
  slots: Hex[];
}

const SHADOW_GAS = "0x1c9c380"; // 30M for the eth_call itself

/** Runs `logic.<calldata>` by DELEGATECALL in a shadow of `ruleContract`'s storage (see file comment). */
export async function shadowDelegateCall(rpc: RpcFn, ruleContract: Address, logic: Address, calldata: Hex, gas: number, block: string = "latest", maxRounds = 6): Promise<ShadowResult> {
  const nonce = BigInt(await rpc<Hex>("eth_getTransactionCount", [ENTRY_POINT, block]));
  const shadowAddr = getContractAddress({ from: ENTRY_POINT, nonce }).toLowerCase();
  const prefill: [Hex, Hex][] = [];
  const known = new Set<string>();
  for (let round = 0; round < maxRounds; round++) {
    const init = shadowInitcode(prefill, logic, calldata, gas);
    const pre = await rpc<Record<string, { storage?: Record<string, Hex> }>>("debug_traceCall", [{ from: ENTRY_POINT, data: init, gas: SHADOW_GAS }, block, { tracer: "prestateTracer" }]);
    const entry = Object.entries(pre ?? {}).find(([a]) => a.toLowerCase() === shadowAddr)?.[1];
    const fresh = Object.keys(entry?.storage ?? {}).filter((s) => !known.has(s.toLowerCase()));
    if (fresh.length === 0) break;
    const vals = await Promise.all(fresh.map((s) => rpc<Hex>("eth_getStorageAt", [ruleContract, s, block])));
    fresh.forEach((s, i) => {
      known.add(s.toLowerCase());
      prefill.push([s as Hex, vals[i]!]);
    });
  }
  const init = shadowInitcode(prefill, logic, calldata, gas);
  try {
    const data = await rpc<Hex>("eth_call", [{ from: ENTRY_POINT, data: init, gas: SHADOW_GAS }, block]);
    return { data, ok: true, slots: prefill.map(([s]) => s) };
  } catch (e) {
    const d = e instanceof RpcError && typeof e.data === "string" ? (e.data as Hex) : ((e as { data?: Hex }).data ?? "0x");
    return { data: d, ok: false, slots: prefill.map(([s]) => s) };
  }
}

/** The logic's `__nonceKey(triggerData)` as Core would compute it for `ruleContract` now. */
export async function deriveNonceKey(rpc: RpcFn, ruleContract: Address, logic: Address, triggerData: Hex, nonceKeyGas: bigint, block?: string): Promise<bigint> {
  const cd = encodeFunctionData({ abi: coreLogicAbi, functionName: "__nonceKey", args: [triggerData] });
  const r = await shadowDelegateCall(rpc, ruleContract, logic, cd, Number(nonceKeyGas), block);
  if (!r.ok) throw new NonceKeyUnavailable(`__nonceKey reverted in the shadow run (data ${r.data}); pass { nonceKey } explicitly`);
  if (size(r.data) !== 32) throw new NonceKeyUnavailable(`__nonceKey returned ${size(r.data)} bytes, expected 32`);
  return BigInt(r.data);
}
