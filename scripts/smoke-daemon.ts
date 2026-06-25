// Verify the daemon's digest-file pass (skipping the network refresh, which is
// the same code path the MCP server already exercises): seed a fitting repo,
// run one pass, and confirm the markdown digest is written and the watermark set.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { Store } from "../src/store/db.js";
import { runDaemonOnce } from "../src/scheduler/daemon.js";

const now = Math.floor(Date.now() / 1000);
const dbPath = join(tmpdir(), `kie-daemon-${Date.now()}.db`);
const digestFile = join(tmpdir(), `kie-digest-${Date.now()}.md`);
process.env.KIE_DIGEST_PATH = digestFile;

const store = new Store(dbPath);
store.setMeta("lastProfileScan", String(now));
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

const res = await runDaemonOnce(store, { skipRefresh: true });
const md = readFileSync(digestFile, "utf8");
console.log(md);
const ok = res.newItems === 1 && md.includes("charm/freshcli") && store.getMeta("lastDaemonDigestAt");
store.close();
console.log(ok ? "\nDAEMON_OK" : "\nFAIL");
process.exit(ok ? 0 : 1);
