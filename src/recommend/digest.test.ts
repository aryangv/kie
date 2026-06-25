import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../store/db.js";
import { buildDigest } from "./digest.js";

// Helper: create a tool with a chosen first_seen, topics, language, and a mention.
function makeTool(
  store: Store,
  repoRef: string,
  firstSeen: number,
  topics: string[],
  name = repoRef.split("/")[1],
  language: string | null = null,
) {
  const now = Math.floor(Date.now() / 1000);
  const id = store.upsertTool(repoRef, `https://github.com/${repoRef}`, name, firstSeen);
  store.applyRepoMeta(id, {
    repoRef, url: `https://github.com/${repoRef}`, name, owner: repoRef.split("/")[0],
    description: "d", language, topics, stars: 10, forks: 0, pushedAt: now, readme: null, fetchedAt: now,
  });
  store.insertMention(
    {
      source: "hackernews", externalId: `m-${repoRef}`, title: "t",
      url: "u", points: 5, createdAt: now - 1800, repoRef,
    },
    id,
  );
  return id;
}

test("digest shows only new + fitting + undecided tools", () => {
  const store = new Store(":memory:");
  const now = Math.floor(Date.now() / 1000);
  const since = now - 2 * 3600;

  // User already covers ui-framework (react incumbent).
  store.upsertProfileRow({ key: "library:react", kind: "library", label: "react", category: "ui-framework", weight: 1, now });
  store.setMeta("lastProfileScan", String(now)); // avoid a real filesystem scan

  // New + agnostic gap (cli) -> should appear.
  makeTool(store, "a/clinew", now - 3600, ["cli"]);
  // Old cli -> filtered out by the watermark.
  makeTool(store, "a/cliold", now - 10 * 86400, ["cli"]);
  // New but a category the user already covers -> "replaces", filtered by fit.
  makeTool(store, "a/react", now - 3600, [], "react");

  const digest = buildDigest(store, { window: "30d", limit: 10, since });
  const refs = digest.items.map((e) => e.tool.repoRef);

  assert.deepEqual(refs, ["a/clinew"]);
  store.close();
});

test("digest surfaces uncategorized repos (flagged uncertain) instead of burying them", () => {
  const store = new Store(":memory:");
  const now = Math.floor(Date.now() / 1000);
  const since = now - 2 * 3600;
  store.upsertProfileRow({ key: "language:typescript", kind: "language", label: "TypeScript", category: null, weight: 1, now });
  store.setMeta("lastProfileScan", String(now));

  // Uncategorized (no recognized topics) + a non-stack language. Under the old
  // gate this was "irrelevant" and dropped; now it should appear as uncertain.
  makeTool(store, "obscure/widgetizer", now - 3600, [], "widgetizer", "Rust");

  const digest = buildDigest(store, { window: "30d", limit: 10, since });
  const hit = digest.items.find((e) => e.tool.repoRef === "obscure/widgetizer");
  assert.ok(hit, "uncategorized repo is surfaced");
  assert.equal(hit!.fit?.uncertain, true);
  store.close();
});

test("first-ever digest (since=null) includes new fitting tools without a watermark", () => {
  const store = new Store(":memory:");
  const now = Math.floor(Date.now() / 1000);
  store.setMeta("lastProfileScan", String(now));
  makeTool(store, "a/clinew", now - 10 * 86400, ["cli"]); // old, but no watermark
  const digest = buildDigest(store, { window: "30d", limit: 10, since: null });
  assert.deepEqual(digest.items.map((e) => e.tool.repoRef), ["a/clinew"]);
  store.close();
});
