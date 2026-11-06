// The MCP server through a real MCP client over an in-memory transport: every tool answers, read-only.
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";

async function client() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer().connect(a);
  const c = new Client({ name: "test", version: "0" });
  await c.connect(b);
  return c;
}
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[] };
  return r.content[0]!.text;
};

describe("popcorn MCP server", () => {
  test("lists its tools, none of which sign or send", async () => {
    const c = await client();
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["build_trigger", "can_trigger", "explain_code", "get_example", "get_module", "how_to_build", "list_examples", "list_modules", "rule_contract_info"]);
  });
  test("catalog: modules by group and one page", async () => {
    const c = await client();
    const priv = JSON.parse(await call(c, "list_modules", { group: "private" }));
    expect(priv.map((m: { id: string }) => m.id).sort()).toEqual(["private-pool", "stealth-address"]);
    const page = JSON.parse(await call(c, "get_module", { id: "open-sponsor" }));
    expect(page.status).toBe("built");
    expect(page.page).toContain("## Runs on");
  });
  test("examples: projects with recorded transactions", async () => {
    const c = await client();
    const all = JSON.parse(await call(c, "list_examples"));
    expect(all.length).toBeGreaterThanOrEqual(5);
    const payroll = JSON.parse(await call(c, "get_example", { id: "private-payroll" }));
    expect(payroll.run.recorded).toBe(true);
    expect(payroll.run.story.length).toBeGreaterThan(2);
    const how = JSON.parse(await call(c, "how_to_build", { id: "sovereign-account" }));
    expect(how.steps.length).toBeGreaterThan(4);
  });
  test("codes: Core and sponsor", async () => {
    const c = await client();
    expect(JSON.parse(await call(c, "explain_code", { code: "0x22" })).name).toBeTruthy();
    expect(JSON.parse(await call(c, "explain_code", { code: 0x6c, frame: "payer" })).reason).toContain("budget");
  });
});
