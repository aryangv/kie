// Live check of the setup flow: scan real code roots, build profile, recommend
// curated starters filtered by what the user already covers.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "mcp", "server.js");
const text = (r: any) => (r.content as { text: string }[])[0].text;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, KIE_DB: join(tmpdir(), `kie-setup-${Date.now()}.db`) },
});
const client = new Client({ name: "smoke-setup", version: "0.0.0" });
await client.connect(transport);

console.log(text(await client.callTool({ name: "setup", arguments: {} })));

await client.close();
console.log("\nSETUP_OK");
process.exit(0);
