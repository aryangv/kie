// Standalone "here's what's new" daemon. The MCP server only runs while an IDE
// session is open and can't push messages on its own, so this is the piece that
// works in the background: on an interval it refreshes the sources and writes a
// digest of what's new-and-fitting to ~/.kie/digest.md (and stdout).
//
// Run it however you like a long-lived process to run — directly
// (`node dist/scheduler/daemon.js` / `npx kie-daemon`), via a Windows
// Task Scheduler "at log on" task, a launchd/systemd unit, or `pm2`.
//
// Config (env):
//   KIE_DIGEST_INTERVAL_MIN  minutes between passes (default 360 = 6h)
//   KIE_DIGEST_PATH          output file (default ~/.kie/digest.md)

import "../env.js"; // must be first: populate process.env before other modules load
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Store } from "../store/db.js";
import { refresh } from "./refresh.js";
import { buildDigest } from "../recommend/digest.js";

export function digestPath(): string {
  if (process.env.KIE_DIGEST_PATH) return process.env.KIE_DIGEST_PATH;
  return join(homedir(), ".kie", "digest.md");
}

export function renderMarkdown(items: ReturnType<typeof buildDigest>["items"], now: number): string {
  const header = `# Kie — what's new\n\n_Updated ${new Date(now * 1000).toISOString()}_\n`;
  if (items.length === 0) {
    return `${header}\nNothing new that fits your stack right now. You're up to date.\n`;
  }
  const body = items
    .map((e) => {
      const lang = e.tool.language ? ` · ${e.tool.language}` : "";
      const reason = e.fit ? `\n  ${e.fit.reason}` : "";
      return (
        `### ${e.tool.repoRef}  (score ${e.breakdown.score}${lang})\n` +
        `${e.tool.description ?? ""}\n\n` +
        `${e.tool.url}${reason}`
      );
    })
    .join("\n\n");
  return `${header}\n${body}\n`;
}

export interface DaemonPassResult {
  newItems: number;
  wrote: string;
}

/** One pass: refresh sources, build the digest since the daemon's own watermark, write the file. */
export async function runDaemonOnce(
  store: Store,
  opts: { skipRefresh?: boolean } = {},
): Promise<DaemonPassResult> {
  if (!opts.skipRefresh) await refresh(store);
  const now = Math.floor(Date.now() / 1000);
  const sinceStr = store.getMeta("lastDaemonDigestAt");
  const since = sinceStr ? Number(sinceStr) : null;

  const digest = buildDigest(store, { window: "7d", limit: 15, since });
  const path = digestPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderMarkdown(digest.items, now), "utf8");
  store.setMeta("lastDaemonDigestAt", String(now));

  return { newItems: digest.items.length, wrote: path };
}

export async function startDaemon(): Promise<void> {
  const intervalMin = Number(process.env.KIE_DIGEST_INTERVAL_MIN ?? 360);
  const store = new Store();
  let running = true;

  const tick = async () => {
    if (!running) return;
    try {
      const res = await runDaemonOnce(store);
      console.log(
        `[kie-daemon] ${new Date().toISOString()} — ${res.newItems} new item(s) → ${res.wrote}`,
      );
    } catch (err) {
      console.error(`[kie-daemon] pass failed:`, err instanceof Error ? err.message : err);
    }
  };

  const shutdown = () => {
    running = false;
    clearInterval(timer);
    store.close();
    console.log("[kie-daemon] stopped");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`[kie-daemon] started; every ${intervalMin} min → ${digestPath()}`);
  await tick(); // run immediately on start
  const timer = setInterval(tick, intervalMin * 60 * 1000);
}

// Run the loop when executed directly (not when imported, e.g. by tests).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  startDaemon().catch((err) => {
    console.error("[kie-daemon] fatal:", err);
    process.exit(1);
  });
}
