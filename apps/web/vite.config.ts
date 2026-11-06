import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const repo = path.resolve(__dirname, "../..");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // the browser uses the simulator's rule table as is (pure TypeScript, no Node APIs)
      "@popcorn/simulator": path.join(repo, "packages/simulator/src/index.ts"),
      // the SDK's transport (devnet table, JSON-RPC, receipts, admission status) has no Node APIs, so the explorer reuses it
      "@popcorn/sdk/transport": path.join(repo, "packages/sdk/src/transport.ts"),
      // the transaction inspector (any hash: stages and the build's flow) is browser-safe too
      "@popcorn/sdk/inspect": path.join(repo, "packages/sdk/src/inspect.ts"),
    },
    // SDK sources import viem; resolve it from this app
    dedupe: ["viem"],
  },
  // the site reads docs/catalog, examples/*/run.json and the READMEs straight from the repository
  server: { fs: { allow: [repo] } },
});
