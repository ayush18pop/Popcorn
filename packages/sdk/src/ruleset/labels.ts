// Presentation only: never changes the encoded rule or its verdict. Unknown selectors stay visible.
import { toFunctionSelector } from "viem";
import type { Node, Op, Source } from "./spec.ts";

export type ContractRoles = Record<string, string>;
const GETTERS = ["totalAssets()", "totalSupply()", "paused()", "price()", "value()", "healthFactor()", "balanceOf(address)"];
const NAMES = new Map(GETTERS.map((name) => [toFunctionSelector(name).toLowerCase(), name]));
const OPS: Record<Op, string> = { lt: "<", le: "≤", gt: ">", ge: "≥", eq: "=", ne: "≠" };
export const contractLabel = (address: string, roles: ContractRoles = {}) =>
  Object.entries(roles).find(([a]) => a.toLowerCase() === address.toLowerCase())?.[1] ?? `${address.slice(0, 8)}…${address.slice(-4)}`;

export function sourceLabel(s: Source, roles: ContractRoles = {}): string {
  if (s.kind === "storage") return `own storage ${s.slot.slice(0, 10)}…`;
  if (s.kind === "getter") return `${contractLabel(s.target, roles)}.${NAMES.get(s.selector.toLowerCase()) ?? s.selector}${s.arg ? ` [${s.arg === "self" ? "this build" : s.arg}]` : ""}`;
  if (s.kind === "ethBalance") return `ETH balance of ${s.account === "self" ? "this build" : contractLabel(s.account, roles)}`;
  return `${contractLabel(s.token, roles)}.balanceOf(${s.account === "self" ? "this build" : contractLabel(s.account, roles)})`;
}

/** Only this exact boolean expression can safely be folded into "not paused". */
export function isNotPaused(n: Node): boolean {
  return n.type === "not" && n.child.type === "cmp" && n.child.op === "gt" && n.child.value === 0n
    && n.child.source.kind === "getter" && !n.child.source.arg
    && n.child.source.selector.toLowerCase() === toFunctionSelector("paused()");
}

export function readableCondition(n: Node, roles: ContractRoles = {}): string | undefined {
  if (isNotPaused(n) && n.type === "not" && n.child.type === "cmp" && n.child.source.kind === "getter")
    return `${contractLabel(n.child.source.target, roles)} is not paused`;
  if (n.type === "cmp") return `${sourceLabel(n.source, roles)} ${OPS[n.op]} ${n.value}`;
  if (n.type === "ratio") {
    const sharePrice = n.a.kind === "getter" && n.b.kind === "getter" && !n.a.arg && !n.b.arg
      && n.a.target.toLowerCase() === n.b.target.toLowerCase()
      && n.a.selector === toFunctionSelector("totalAssets()") && n.b.selector === toFunctionSelector("totalSupply()");
    return `${sharePrice ? `${contractLabel(n.a.kind === "getter" ? n.a.target : "", roles)} share price` : `${sourceLabel(n.a, roles)} / ${sourceLabel(n.b, roles)}`} ${OPS[n.op]} ${decimalRatio(n.num, n.den)}`;
  }
}

export function decimalRatio(a: bigint, b: bigint): string {
  if (b === 0n) return "undefined (division by zero)";
  const whole = a / b;
  const fraction = ((a % b) * 1_000_000n / b).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}${(a % b) * 1_000_000n % b !== 0n ? "…" : ""}`;
}
