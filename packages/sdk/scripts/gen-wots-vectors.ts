// Vectors for contracts/test/CoreWots.t.sol: the TypeScript signer's WOTS+ signatures from a fixed THROWAWAY tree (the seeds
// below are test data, not keys). Core's wotsVerify (extracted verbatim into contracts/core/out/PopcornCore.wots-harness.bin) must accept
// every one and reject every mutation. Run: bun packages/sdk/scripts/gen-wots-vectors.ts
import { writeFileSync } from "node:fs";
import { keccak256, toHex } from "viem";
import { wotsKeygen, wotsSign, wotsSteps } from "../src/wots.ts";

const tree = wotsKeygen(`0x${"5e".repeat(32)}`, `0x${"9d".repeat(32)}`);
const leaves = [0, 1, 2, 5, 31, 32, 255, 256, 511, 512, 1000, 1022, 1023];
const vectors = leaves.flatMap((leaf) =>
  [0, 1, 2].map((i) => {
    const msg = keccak256(toHex(`wots-vector-${leaf}-${i}`));
    return { root: tree.root, pubSeed: tree.pubSeed, leaf, msg, steps: wotsSteps(msg), entry: wotsSign(tree, msg, leaf) };
  }),
);
// extreme digit patterns: all-zero digits (max steps 960), all-F digits (0 steps), alternating
for (const [name, msg] of [["zeros", `0x${"00".repeat(32)}`], ["ones", `0x${"ff".repeat(32)}`], ["alt", `0x${"0f".repeat(32)}`]] as const) {
  vectors.push({ root: tree.root, pubSeed: tree.pubSeed, leaf: 7, msg, steps: wotsSteps(msg), entry: wotsSign(tree, msg, 7) });
  void name;
}
writeFileSync(new URL("../../../contracts/test/fixtures/wots-vectors.json", import.meta.url).pathname, JSON.stringify(vectors, null, 1) + "\n");
console.log(`${vectors.length} vectors, root ${tree.root}`);
