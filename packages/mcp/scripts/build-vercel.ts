// Assembles a Vercel Build Output (v3) for the hosted MCP server in packages/mcp/vercel/.vercel/output:
//   /mcp  a Node function: src/http.ts bundled with the SDK, plus docs/catalog and examples/*/*/{project.md,run.json}
//   /     a short page saying how to connect
// Then: cd packages/mcp/vercel && vercel deploy --prebuilt --prod
import { cpSync, mkdirSync, rmSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../../", import.meta.url).pathname;
const OUT = new URL("../vercel/.vercel/output/", import.meta.url).pathname;
const FN = join(OUT, "functions/mcp.func");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(FN, { recursive: true });

const r = await Bun.build({ entrypoints: [new URL("../src/http.ts", import.meta.url).pathname], target: "node", format: "esm", minify: true });
if (!r.success) throw new AggregateError(r.logs, "bundle failed");
writeFileSync(join(FN, "index.mjs"), await r.outputs[0]!.text());

// the data the read-only tools serve
cpSync(join(ROOT, "docs/catalog"), join(FN, "repo/docs/catalog"), { recursive: true });
for (const group of readdirSync(join(ROOT, "examples"))) {
  for (const id of readdirSync(join(ROOT, "examples", group))) {
    for (const f of ["project.md", "run.json"]) {
      const src = join(ROOT, "examples", group, id, f);
      if (existsSync(src)) cpSync(src, join(FN, "repo/examples", group, id, f));
    }
  }
}
writeFileSync(join(FN, ".vc-config.json"), JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: true, maxDuration: 60, environment: { POPCORN_ROOT: "/var/task/repo/" } }, null, 2));
mkdirSync(join(OUT, "static"), { recursive: true });
writeFileSync(
  join(OUT, "static/index.html"),
  `<!doctype html><meta charset="utf-8"><title>Popcorn MCP</title><body style="font:15px/1.5 system-ui;max-width:640px;margin:48px auto;padding:0 16px">
<h1>Popcorn MCP</h1><p>The read-only Popcorn MCP server (block catalog, examples and their recorded runs, Core codes, trigger
simulation and inspection on the public devnet). It holds no key and sends nothing.</p>
<pre>claude mcp add --transport http popcorn https://${"$"}{location.host}/mcp</pre>
<p>Endpoint: <code>/mcp</code> (Streamable HTTP, POST).</p></body>`.replace("${location.host}", "&lt;this host&gt;"),
);
writeFileSync(join(OUT, "config.json"), JSON.stringify({ version: 3 }, null, 2));
console.log(`wrote ${OUT}`);
