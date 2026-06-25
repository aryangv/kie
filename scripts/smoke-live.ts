// Live check: scan the real code roots to build a profile, then ask for a fit
// verdict on a real repo (one GitHub API call). Network-dependent.
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
  env: { ...process.env, KIE_DB: join(tmpdir(), `kie-live-${Date.now()}.db`) },
});
const client = new Client({ name: "smoke-live", version: "0.0.0" });
await client.connect(transport);

console.log("=== profile_update rescan (real code roots) ===");
console.log(text(await client.callTool({ name: "profile_update", arguments: { rescan: true } })));

const repo = process.argv[2] ?? "tailwindlabs/tailwindcss";
console.log(`\n=== should_i_use ${repo} ===`);
console.log(text(await client.callTool({ name: "should_i_use", arguments: { repo } })));

await client.close();
console.log("\nLIVE_OK");
process.exit(0);
