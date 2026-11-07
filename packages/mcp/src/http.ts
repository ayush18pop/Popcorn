// popcorn-mcp over Streamable HTTP, for a hosted deployment (a Vercel Node function; also any Node http server).
// Stateless: every request gets a fresh server and transport, so no session needs to survive between invocations.
// Read-only like the stdio server: it holds no key and sends nothing.
//   claude mcp add --transport http popcorn https://<deployment>/mcp
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.ts";

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, mcp-protocol-version, mcp-session-id, accept");
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  if (req.method !== "POST") {
    // stateless: no server-initiated stream (GET) and no session to delete (DELETE)
    return void res.writeHead(405, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "POST JSON-RPC to this endpoint" }, id: null }));
  }
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
