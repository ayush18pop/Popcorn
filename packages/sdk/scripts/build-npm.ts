// build-npm: builds a publishable copy of the SDK into packages/sdk/npm/ (the workspace package stays source-only).
//
//   NPM_NAME=@your-scope/popcorn-sdk bun scripts/build-npm.ts     # NPM_NAME defaults to the value below
//   cd npm && npm publish --access public
//
// JS is bundled with Bun (ESM, node target). @popcorn/simulator is inlined; viem and @noble/* stay peer/real deps.
// Types come from tsc; the simulator's declarations are copied in and the import specifier rewritten.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "npm");
const SIM = join(ROOT, "..", "simulator");
const NAME = process.env.NPM_NAME ?? "@popcorn-eth/sdk";
const src = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const VERSION = process.env.NPM_VERSION ?? src.version;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. JS bundles
const external = ["viem", "viem/*", "@noble/*"];
for (const [entry, outdir] of [
  ["src/index.ts", "dist"],
  ["bin/popcorn-simulate.ts", "dist/bin"],
] as const) {
  const r = await Bun.build({ entrypoints: [join(ROOT, entry)], outdir: join(OUT, outdir), target: "node", format: "esm", external, sourcemap: "linked" });
  if (!r.success) {
    for (const l of r.logs) console.error(l);
    process.exit(1);
  }
}
// bin: point at the bundled library instead of a second copy, and run under node
const binPath = join(OUT, "dist/bin/popcorn-simulate.js");
let bin = readFileSync(binPath, "utf8").replace(/^#!.*\n/, "");
writeFileSync(binPath, "#!/usr/bin/env node\n" + bin);

// 2. declarations
const tsconfig = {
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", lib: ["ES2022", "DOM"], strict: true,
    skipLibCheck: true, isolatedModules: true, verbatimModuleSyntax: true, allowImportingTsExtensions: true,
    rewriteRelativeImportExtensions: true, declaration: true, emitDeclarationOnly: true, types: ["node", "bun"],
    rootDir: ROOT, outDir: join(OUT, "dist/types"), noCheck: true,
  },
  files: [join(ROOT, "src/index.ts")],
};
const tmpCfg = join(ROOT, "tsconfig.npm.tmp.json");
writeFileSync(tmpCfg, JSON.stringify(tsconfig));
try {
  execFileSync(join(ROOT, "node_modules/.bin/tsc"), ["-p", tmpCfg], { stdio: "inherit" });
} finally {
  rmSync(tmpCfg);
}
// tsc follows the workspace symlink into ../simulator; whatever it emitted, emit the simulator cleanly into types/_simulator
const simOut = join(OUT, "dist/types/_simulator");
execFileSync(join(ROOT, "node_modules/.bin/tsc"), [
  "--declaration", "--emitDeclarationOnly", "--noCheck", "--skipLibCheck", "--allowImportingTsExtensions", "--rewriteRelativeImportExtensions",
  "--module", "ESNext", "--moduleResolution", "Bundler", "--target", "ES2022", "--rootDir", join(SIM, "src"), "--outDir", simOut,
  join(SIM, "src/index.ts"),
], { stdio: "inherit" });

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const typesSrc = join(OUT, "dist/types/src");
if (!existsSync(join(typesSrc, "index.d.ts"))) throw new Error("tsc did not emit dist/types/src/index.d.ts");
for (const f of walk(join(OUT, "dist/types")).filter((f) => f.endsWith(".d.ts"))) {
  let s = readFileSync(f, "utf8");
  let rel = relative(dirname(f), join(simOut, "index.js"));
  if (!rel.startsWith(".")) rel = "./" + rel;
  s = s.replaceAll(/(["'])@popcorn\/simulator\1/g, `"${rel}"`).replaceAll(/(\.\.?\/[^"']+)\.ts(["'])/g, "$1.js$2");
  writeFileSync(f, s);
}

// 3. runtime assets used by falcon.ts (new URL("../scripts/falcon_sign.py", import.meta.url) resolves from dist/)
mkdirSync(join(OUT, "scripts"));
cpSync(join(ROOT, "scripts/falcon_sign.py"), join(OUT, "scripts/falcon_sign.py"));
cpSync(join(ROOT, "vendor"), join(OUT, "vendor"), { recursive: true, filter: (p) => !p.includes("__pycache__") });
cpSync(join(ROOT, "README.md"), join(OUT, "README.md"));
cpSync(join(ROOT, "../../LICENSE"), join(OUT, "LICENSE"));

// 4. package.json
const deps = Object.fromEntries(Object.entries(src.dependencies as Record<string, string>).filter(([k]) => !k.startsWith("@popcorn/")));
writeFileSync(join(OUT, "package.json"), JSON.stringify({
  name: NAME,
  version: VERSION,
  description: "A viem extension for Popcorn rule contracts on EIP-8141 frame-transaction networks.",
  license: "MIT",
  type: "module",
  main: "./dist/index.js",
  types: "./dist/types/src/index.d.ts",
  exports: { ".": { types: "./dist/types/src/index.d.ts", import: "./dist/index.js" }, "./package.json": "./package.json" },
  bin: { "popcorn-simulate": "./dist/bin/popcorn-simulate.js" },
  files: ["dist", "scripts", "vendor", "README.md", "LICENSE"],
  engines: { node: ">=20" },
  repository: { type: "git", url: "git+https://github.com/ayush18pop/Popcorn.git", directory: "packages/sdk" },
  keywords: ["ethereum", "eip-8141", "frame-transactions", "viem", "account-abstraction"],
  dependencies: deps,
  publishConfig: { access: "public" },
}, null, 2) + "\n");

console.log(`built ${NAME}@${VERSION} into ${relative(process.cwd(), OUT) || "."}`);
