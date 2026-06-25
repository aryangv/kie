// Verify whats_new through the MCP server without a live network refresh:
// seed a temp DB with a profile + one new fitting repo, mark caches fresh, then
// call the tool and confirm the repo shows up in the digest.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store/db.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "mcp", "server.js");
const text = (r: any) => (r.content as { text: string }[])[0].text;
const dbPath = join(tmpdir(), `kie-wn-${Date.now()}.db`);
const now = Math.floor(Date.now() / 1000);

// --- seed ---
const store = new Store(dbPath);
store.setMeta("lastRefresh", String(now)); // skip live refresh
store.setMeta("lastProfileScan", String(now)); // skip filesystem scan
store.upsertProfileRow({ key: "library:react", kind: "library", label: "react", category: "ui-framework", weight: 1, now });
const id = store.upsertTool("charm/freshcli", "https://github.com/charm/freshcli", "freshcli", now - 3600);
store.applyRepoMeta(id, {
  repoRef: "charm/freshcli", url: "https://github.com/charm/freshcli", name: "freshcli", owner: "charm",
  description: "a new terminal tool", language: null, topics: ["cli"], stars: 200, forks: 0,
  pushedAt: now, readme: null, fetchedAt: now,
});
store.insertMention(
  { source: "hackernews", externalId: "x1", title: "Show HN: freshcli", url: "u", points: 120, createdAt: now - 1800, repoRef: "charm/freshcli" },
  id,
);
store.close();

// --- exercise ---
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, KIE_DB: dbPath },
});
const client = new Client({ name: "smoke-wn", version: "0.0.0" });
await client.connect(transport);
const out = text(await client.callTool({ name: "whats_new", arguments: { peek: true } }));
console.log(out);
await client.close();
console.log(out.includes("charm/freshcli") ? "\nWHATSNEW_OK" : "\nFAIL: digest missing the new tool");
process.exit(out.includes("charm/freshcli") ? 0 : 1);
