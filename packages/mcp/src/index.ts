#!/usr/bin/env bun
// popcorn-mcp: the read-only Popcorn MCP server over stdio.
//   claude mcp add popcorn -- bun /path/to/Popcorn/packages/mcp/src/index.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.ts";

await createServer().connect(new StdioServerTransport());
