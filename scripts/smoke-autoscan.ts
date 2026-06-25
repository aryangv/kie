// Prove the living profile self-builds: fresh DB, default code roots, and the
// very first profile_get must already be populated (no explicit rescan).
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
  env: { ...process.env, KIE_DB: join(tmpdir(), `kie-auto-${Date.now()}.db`) },
});
const client = new Client({ name: "smoke-auto", version: "0.0.0" });
await client.connect(transport);

const out = text(await client.callTool({ name: "profile_get", arguments: {} }));
console.log(out);
console.log(
  out.includes("empty")
    ? "\nFAIL: profile did not auto-scan"
    : "\nAUTOSCAN_OK: profile self-built on first use",
);
await client.close();
process.exit(out.includes("empty") ? 1 : 0);
