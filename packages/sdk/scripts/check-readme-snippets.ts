// Every ```ts / ```typescript / ```solidity code block in the READMEs listed below must be a verbatim excerpt (whitespace aside)
// of a file in packages/sdk/examples/ or contracts/src/examples/, which `bun run build` typechecks / compiles. So no README
// sample can drift from code that compiles. Other fences (sh, text, json) are not checked.
//   bun packages/sdk/scripts/check-readme-snippets.ts
import { readdirSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url).pathname;
const READMES = ["packages/sdk/README.md", "README.md"];
const SOURCES = ["packages/sdk/examples", "contracts/src/examples"];

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const corpus = SOURCES.flatMap((d) => readdirSync(`${root}${d}`).map((f) => norm(readFileSync(`${root}${d}/${f}`, "utf8"))));

let bad = 0;
let n = 0;
for (const r of READMES) {
  const md = readFileSync(`${root}${r}`, "utf8");
  for (const m of md.matchAll(/```(ts|typescript|solidity)\n([\s\S]*?)```/g)) {
    n++;
    if (!corpus.some((c) => c.includes(norm(m[2]!)))) {
      bad++;
      console.error(`${r}: a ${m[1]} block is not an excerpt of the examples:\n${m[2]!.split("\n").slice(0, 4).join("\n")}\n...`);
    }
  }
}
if (bad) {
  console.error(`${bad} of ${n} code blocks are not verbatim excerpts of packages/sdk/examples or contracts/src/examples`);
  process.exit(1);
}
console.log(`readme snippets ok: ${n} code blocks are excerpts of compiled examples`);
