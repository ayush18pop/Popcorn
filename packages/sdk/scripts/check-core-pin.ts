// Fails loudly when the built Core (contracts/core/out/PopcornCore.bin) is not the Core the factory pins, or when contracts/core/out is
// missing / older than contracts/core/PopcornCore.yul. Run by `bun run build` and `bun run test`.
//   bun packages/sdk/scripts/check-core-pin.ts
import { existsSync, readFileSync, statSync } from "node:fs";
import { keccak256, type Hex } from "viem";

const root = new URL("../../../", import.meta.url).pathname;
const bin = `${root}contracts/core/out/PopcornCore.bin`;
const die = (m: string): never => {
  console.error(`\nSTALE OR MISSING BUILD: ${m}\nFix: bun run build\n`);
  process.exit(1);
};
if (!existsSync(bin)) die("contracts/core/out/PopcornCore.bin does not exist (contracts/core/out is git-ignored, build it)");
if (statSync(bin).mtimeMs < statSync(`${root}contracts/core/PopcornCore.yul`).mtimeMs && !process.env.POPCORN_SKIP_MTIME) {
  die("contracts/core/out/PopcornCore.bin is older than contracts/core/PopcornCore.yul");
}
const creation = `0x${readFileSync(bin, "utf8").trim().replace(/^0x/, "")}` as Hex;
const hash = keccak256(creation).toLowerCase();
const src = readFileSync(`${root}contracts/src/rules/RuleFactory.sol`, "utf8");
const pin = src.match(/CORE_CREATION_CODE_HASH\s*=\s*(0x[0-9a-fA-F]{64})/)?.[1]?.toLowerCase();
if (!pin) die("RuleFactory.sol has no CORE_CREATION_CODE_HASH");
if (pin !== hash) die(`Core creation hash ${hash} != the factory's pinned ${pin}. contracts/core/out is stale (or the Core changed without re-pinning the factory).`);
console.log(`core pin ok: ${hash}`);
