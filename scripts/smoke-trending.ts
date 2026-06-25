// Real end-to-end: boot the server (it loads .env -> GITHUB_TOKEN), force a
// live collection + enrichment pass, then rank what's trending. Network-heavy.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "mcp", "server.js");
const text = (r: any) => (r.content as { text: string }[])[0].text;

// Temp DB so we don't touch ~/.kie; let the server load .env for the token.
const env = { ...process.env, KIE_DB: join(tmpdir(), `kie-trend-${Date.now()}.db`) };
const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env });
const client = new Client({ name: "smoke-trending", version: "0.0.0" });
await client.connect(transport);

console.log("=== refresh_now (live) ===");
console.log(text(await client.callTool({ name: "refresh_now", arguments: {} })));

console.log("\n=== whats_trending (7d, top 12) ===");
console.log(text(await client.callTool({ name: "whats_trending", arguments: { window: "7d", limit: 12 } })));

await client.close();
console.log("\nTRENDING_OK");
process.exit(0);
