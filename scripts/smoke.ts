// Boot the built server over stdio with an MCP client, list tools, and call a
// couple that don't need the network, to prove the wiring end-to-end.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "mcp", "server.js");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  // Isolated temp DB and an empty code root so nothing real is touched.
  env: {
    ...process.env,
    KIE_DB: join(tmpdir(), `kie-smoke-${Date.now()}.db`),
    KIE_CODE_ROOTS: join(tmpdir(), "kie-empty"),
  },
});

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("Tools:", tools.tools.map((t) => t.name).join(", "));

const profile = await client.callTool({ name: "profile_get", arguments: {} });
console.log("\nprofile_get ->\n", (profile.content as { text: string }[])[0].text);

const fit = await client.callTool({
  name: "should_i_use",
  arguments: { repo: "this-owner-does-not-exist-xyz/nope" },
});
console.log("\nshould_i_use(bogus) ->\n", (fit.content as { text: string }[])[0].text);

await client.close();
console.log("\nSMOKE_OK");
process.exit(0);
