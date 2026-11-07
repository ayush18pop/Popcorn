import { describe, expect, it } from "vitest";
import { getter, ratio, not, compare } from "../src/ruleset/spec.ts";
import { contractLabel, decimalRatio, isNotPaused, readableCondition, sourceLabel } from "../src/ruleset/labels.ts";
import { deriveFromInclusion, type Flow } from "../src/inspect.ts";
const vault = "0x00000000000000000000000000000000000b0001";
const roles = { [vault]: "vault" };
describe("explorer explanations", () => {
  it("resolves known selectors, preserves unknown selectors, and uses explicit roles", () => {
    expect(sourceLabel(getter(vault, "totalAssets()"), roles)).toBe("vault.totalAssets()");
    expect(sourceLabel(getter(vault, "0x12345678"), roles)).toContain("0x12345678");
    expect(contractLabel(vault.toUpperCase(), roles)).toBe("vault");
    expect(readableCondition(ratio(getter(vault, "totalAssets()"), getter(vault, "totalSupply()"), "lt", 1n, 1n), roles)).toBe("vault share price < 1");
  });
  it("folds only the exact NOT paused expression", () => {
    const check = not(compare(getter(vault, "paused()"), "gt", 0n));
    expect(isNotPaused(check)).toBe(true);
    expect(readableCondition(check, roles)).toBe("vault is not paused");
    expect(isNotPaused(not(compare(getter(vault, "price()"), "gt", 0n)))).toBe(false);
    expect(isNotPaused(not(compare(getter(vault, "paused()"), "gt", 1n)))).toBe(false);
  });
  it("formats ratios without floating point loss and marks truncation", () => {
    expect(decimalRatio(8800000000000000n, 10000000000000000n)).toBe("0.88");
    expect(decimalRatio(1n, 3n)).toBe("0.333333…");
    expect(decimalRatio(1n, 0n)).toContain("undefined");
  });
  it("never presents today's values as values at inclusion", () => {
    const flow: Flow = { source: "ruleset", trigger: "pause", evaluated: "current-state", observedBlock: 123, nodes: [
      { index: 0, kind: "condition", blockId: "compare", inputs: [], label: "share price < 1", result: "no", observation: "ratio = 1.1" },
      { index: 1, kind: "action", blockId: "pause", inputs: [0], label: "pause vault", result: "skipped" },
    ] };
    const included = deriveFromInclusion(flow, true);
    expect(included.observedBlock).toBeUndefined();
    expect(included.nodes[0]?.observation).toBeUndefined();
    expect(included.nodes[0]?.result).toBe("yes");
  });
});
