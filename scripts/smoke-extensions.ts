// Live check: recommend Claude Code extensions against the real profile,
// installed setup (~/.claude), and live GitHub discovery (uses .env token).
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
  env: { ...process.env, KIE_DB: join(tmpdir(), `kie-ext-${Date.now()}.db`) },
});
const client = new Client({ name: "smoke-ext", version: "0.0.0" });
await client.connect(transport);
console.log(text(await client.callTool({ name: "recommend_extensions", arguments: {} })));
await client.close();
console.log("\nEXT_OK");
process.exit(0);
