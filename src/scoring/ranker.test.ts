import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../store/db.js";
import { rankTrending, measuredStarsDelta } from "./ranker.js";
import type { RawMention, RepoMeta } from "../types.js";
import type { MetricRow } from "../store/db.js";

function metaFor(repoRef: string, name: string, stars: number, now: number): RepoMeta {
  return {
    repoRef, url: `https://github.com/${repoRef}`, name, owner: repoRef.split("/")[0],
    description: "d", language: "TypeScript", topics: [], stars, forks: 0,
    pushedAt: now, readme: null, fetchedAt: now,
  };
}

function metric(p: Partial<MetricRow> & { captured_at: number; stars: number }): MetricRow {
  return { id: 0, tool_id: 0, mention_count: 1, ...p };
}

function mention(p: Partial<RawMention> & { source: RawMention["source"]; externalId: string; repoRef: string }): RawMention {
  return {
    title: "t",
    url: "https://example.com",
    points: 10,
    createdAt: Math.floor(Date.now() / 1000) - 3600,
    ...p,
  };
}

function seed(): Store {
  const store = new Store(":memory:");
  const now = Math.floor(Date.now() / 1000);

  // Tool A: mentioned on 3 sources, high engagement.
  const a = store.upsertTool("a/one", "https://github.com/a/one", "one", now);
  store.applyRepoMeta(a, {
    repoRef: "a/one", url: "https://github.com/a/one", name: "one", owner: "a",
    description: "d", language: "TypeScript", topics: [], stars: 2000, forks: 0,
    pushedAt: now, readme: null, fetchedAt: now,
  });
  for (const s of ["hackernews", "reddit", "lobsters"] as const) {
    store.insertMention(mention({ source: s, externalId: `${s}-a`, repoRef: "a/one", points: 200 }), a);
  }

  // Tool B: single source, low engagement.
  const b = store.upsertTool("b/two", "https://github.com/b/two", "two", now);
  store.applyRepoMeta(b, {
    repoRef: "b/two", url: "https://github.com/b/two", name: "two", owner: "b",
    description: "d", language: "Go", topics: [], stars: 50, forks: 0,
    pushedAt: now, readme: null, fetchedAt: now,
  });
  store.insertMention(mention({ source: "hackernews", externalId: "hn-b", repoRef: "b/two", points: 5 }), b);

  return store;
}

test("ranks broadly-discussed tool above a single-source one", () => {
  const store = seed();
  const ranked = rankTrending(store, { window: "7d", limit: 10 });
  assert.equal(ranked[0].tool.repoRef, "a/one");
  assert.ok(ranked[0].breakdown.score > ranked[1].breakdown.score);
  store.close();
});

test("language filter narrows results", () => {
  const store = seed();
  const go = rankTrending(store, { window: "7d", limit: 10, language: "Go" });
  assert.equal(go.length, 1);
  assert.equal(go[0].tool.repoRef, "b/two");
  store.close();
});

test("persists scores for the window", () => {
  const store = seed();
  rankTrending(store, { window: "24h", limit: 10 });
  const row = store.db.prepare("SELECT COUNT(*) c FROM scores WHERE time_window = '24h'").get() as { c: number };
  assert.ok(row.c >= 2);
  store.close();
});

test("measuredStarsDelta uses the pre-cutoff baseline and clamps negatives", () => {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - 7 * 24 * 3600;
  const series = [
    metric({ captured_at: cutoff - 3600, stars: 100 }), // baseline (last before cutoff)
    metric({ captured_at: cutoff - 60, stars: 110 }),    // also before cutoff -> newer baseline
    metric({ captured_at: now, stars: 600 }),            // latest
  ];
  assert.equal(measuredStarsDelta(series, cutoff), 490); // 600 - 110

  // All snapshots inside the window -> earliest is the baseline.
  const inWindow = [metric({ captured_at: cutoff + 60, stars: 200 }), metric({ captured_at: now, stars: 350 })];
  assert.equal(measuredStarsDelta(inWindow, cutoff), 150);

  // A star-count correction (delta < 0) clamps to 0, never negative velocity.
  const dropped = [metric({ captured_at: cutoff + 60, stars: 500 }), metric({ captured_at: now, stars: 400 })];
  assert.equal(measuredStarsDelta(dropped, cutoff), 0);

  // Too little history to measure a span.
  assert.equal(measuredStarsDelta([metric({ captured_at: now, stars: 10 })], cutoff), undefined);
});

test("established mode surfaces an old useful repo that trending excludes", () => {
  const store = new Store(":memory:");
  const now = Math.floor(Date.now() / 1000);
  const old = now - 60 * 24 * 3600; // last discussed 60 days ago — outside any window

  // An old, well-established, still-maintained repo, only ever mentioned long ago.
  const t = store.upsertTool("old/gold", "https://github.com/old/gold", "gold", now);
  store.applyRepoMeta(t, metaFor("old/gold", "gold", 80000, now)); // pushedAt: now -> maintained
  store.insertMention(
    mention({ source: "hackernews", externalId: "hn-old", repoRef: "old/gold", points: 100, createdAt: old }),
    t,
  );

  // Trending gates on a mention inside the window -> the old repo is invisible.
  const trending = rankTrending(store, { window: "7d", limit: 10 });
  assert.equal(trending.find((e) => e.tool.repoRef === "old/gold"), undefined);

  // Established considers everything Kie has ever seen -> the old repo surfaces.
  const established = rankTrending(store, { window: "7d", limit: 10, sort: "established" });
  assert.ok(
    established.find((e) => e.tool.repoRef === "old/gold"),
    "established mode includes the old, useful repo regardless of recent buzz",
  );
  store.close();
});

test("established scores are persisted under a mode-namespaced window key", () => {
  const store = seed();
  rankTrending(store, { window: "7d", limit: 10, sort: "established" });
  const est = store.db
    .prepare("SELECT COUNT(*) c FROM scores WHERE time_window = '7d:established'")
    .get() as { c: number };
  assert.ok(est.c >= 1, "established run persisted under '7d:established'");
  // And it didn't clobber a plain trending '7d' key.
  rankTrending(store, { window: "7d", limit: 10 });
  const tr = store.db.prepare("SELECT COUNT(*) c FROM scores WHERE time_window = '7d'").get() as {
    c: number;
  };
  assert.ok(tr.c >= 1, "trending '7d' scores coexist");
  store.close();
});

test("velocity tracks measured star delta, not absolute star count", () => {
  const store = new Store(":memory:");
  const now = Math.floor(Date.now() / 1000);
  const beforeWindow = now - 8 * 24 * 3600; // older than the 7d cutoff

  // Huge but static: 200k stars, zero recent growth.
  const big = store.upsertTool("big/repo", "https://github.com/big/repo", "big", now);
  store.applyRepoMeta(big, metaFor("big/repo", "big", 200000, now));
  store.insertMention(mention({ source: "hackernews", externalId: "hn-big", repoRef: "big/repo", points: 10 }), big);
  store.recordMetric(big, beforeWindow, 200000, 1);
  store.recordMetric(big, now, 200000, 1);

  // Small but surging: 600 stars, +500 over the window.
  const fast = store.upsertTool("fast/repo", "https://github.com/fast/repo", "fast", now);
  store.applyRepoMeta(fast, metaFor("fast/repo", "fast", 600, now));
  store.insertMention(mention({ source: "hackernews", externalId: "hn-fast", repoRef: "fast/repo", points: 10 }), fast);
  store.recordMetric(fast, beforeWindow, 100, 1);
  store.recordMetric(fast, now, 600, 1);

  const ranked = rankTrending(store, { window: "7d", limit: 10 });
  const byRef = new Map(ranked.map((e) => [e.tool.repoRef, e]));
  assert.ok(
    byRef.get("fast/repo")!.breakdown.velocity > byRef.get("big/repo")!.breakdown.velocity,
    "the surging repo should out-velocity the static mega-repo",
  );
  store.close();
});
