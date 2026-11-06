// The transaction inspector's pure parts: reading trigger and verify data back out of frames, parsing a sidecar refusal,
// and deriving node results from an inclusion (only what the flow's logic proves).
import { encodeAbiParameters, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { coreMeaning, deriveFromInclusion, parseRefusal, triggerOf, type Flow, type FlowNodeView } from "../src/inspect.ts";

const B = "0x00000000000000000000000000000000000b0001" as Address;
const P = "0x00000000000000000000000000000000000b0002" as Address;
const pop = (args: Hex): Hex => `0xd9292504${encodeAbiParameters([{ type: "bytes" }], [args]).slice(2)}` as Hex;

describe("triggerOf", () => {
  it("rule-pays: VERIFY frame data is the verify data, the SENDER frame carries pop(triggerData)", () => {
    const t = triggerOf(B, [
      { mode: 1, flags: 3, target: null, data: "0xabcd" },
      { mode: 2, flags: 0, target: null, data: pop("0x1234") },
    ]);
    expect(t).toEqual({ triggerData: "0x1234", verifyData: "0xabcd", payer: null });
  });
  it("caller-pays: a VERIFY frame aimed at another account is the payer", () => {
    const t = triggerOf(B, [
      { mode: 1, flags: 1, target: B, data: "0x" },
      { mode: 1, flags: 2, target: P, data: "0x99" },
      { mode: 2, flags: 0, target: null, data: pop("0x") },
    ]);
    expect(t.payer).toBe(P);
    expect(t.triggerData).toBe("0x");
    expect(t.verifyData).toBe("0x");
  });
});

describe("parseRefusal and Core codes", () => {
  it("reads the frame and the code from the sidecar's detail", () => {
    expect(parseRefusal("validation frame 0: reverted with data 0x0000000000000000000000000000000000000000000000000000000000000022")).toEqual({ frame: 0, code: 0x22 });
    expect(parseRefusal("validation frame 1: reverted with data 0x6d")).toEqual({ frame: 1, code: 0x6d });
    expect(parseRefusal("entity 0xabc validation gas 260909 exceeds unstaked budget 250000 (BUDGET-010)")).toBeNull();
  });
  it("explains a Core code in plain English", () => {
    expect(coreMeaning(0x22)).toMatch(/^Core 0x22 \(condition is false\): The rule contract's condition is not true/);
  });
});

const n = (index: number, kind: FlowNodeView["kind"], blockId: string, inputs: number[]): FlowNodeView => ({ index, kind, blockId, label: `${kind} ${index}`, result: "no", inputs });
const flow = (nodes: FlowNodeView[]): Flow => ({ source: "explain", trigger: "t", evaluated: "current-state", nodes });

describe("deriveFromInclusion", () => {
  it("an included AND proves every input; chained actions ran", () => {
    const f = deriveFromInclusion(flow([n(0, "trigger", "", []), n(1, "payer", "self-paying", [0]), n(2, "condition", "pause", [0]), n(3, "condition", "exploit-proof", [0]), n(4, "operator", "and", [2, 3]), n(5, "action", "pause", [4]), n(6, "action", "reward-pool", [5])]), true);
    expect(f.evaluated).toBe("inclusion");
    expect(f.nodes.map((x) => x.result)).toEqual(["yes", "yes", "yes", "yes", "yes", "yes", "yes"]);
  });
  it("an included OR does not say which input held; NOT proves its input was no", () => {
    const f = deriveFromInclusion(flow([n(0, "trigger", "", []), n(1, "condition", "compare", [0]), n(2, "condition", "compare", [0]), n(3, "operator", "or", [1, 2]), n(4, "condition", "compare", [0]), n(5, "operator", "not", [4]), n(6, "operator", "and", [3, 5]), n(7, "action", "call", [6])]), true);
    expect(f.nodes.map((x) => x.result)).toEqual(["yes", "not-recorded", "not-recorded", "yes", "no", "yes", "yes", "yes"]);
  });
  it("a condition after an action (a vote reaching quorum) is not recorded, and neither is what it gates", () => {
    const f = deriveFromInclusion(flow([n(0, "trigger", "", []), n(1, "condition", "membership-proof", [0]), n(2, "action", "anonymous-vote", [1]), n(3, "condition", "anonymous-vote", [2]), n(4, "action", "key-rotation", [3])]), true);
    expect(f.nodes.map((x) => x.result)).toEqual(["yes", "yes", "yes", "not-recorded", "not-recorded"]);
  });
  it("a reverted action frame shows the actions red", () => {
    const f = deriveFromInclusion(flow([n(0, "trigger", "", []), n(1, "condition", "", [0]), n(2, "action", "call", [1])]), false);
    expect(f.nodes[2]!.result).toBe("no");
    expect(f.nodes[1]!.result).toBe("yes");
  });
});
