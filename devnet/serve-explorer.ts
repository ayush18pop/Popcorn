// Serves the devnet-ui build (static files) with single-page-app fallback, so /tx/<hash> deep links work
// (the organisers host the same app on Cloudflare with "not_found_handling": "single-page-application").
// Usage: bun devnet/serve-explorer.ts <dist dir> <port>
import { existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

const [dir, port] = [process.argv[2]!, Number(process.argv[3] ?? 14339)];
const index = Bun.file(join(dir, "index.html"));
Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(dir, path);
    if (file.startsWith(dir) && existsSync(file) && statSync(file).isFile()) return new Response(Bun.file(file));
    return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
console.log(`explorer on http://127.0.0.1:${port} serving ${dir}`);
