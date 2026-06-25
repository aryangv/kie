import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLobsters } from "./lobsters.js";

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

function story(over: Partial<Parameters<typeof parseLobsters>[0][number]> = {}) {
  return {
    short_id: "abc", title: "t", url: "https://github.com/oven-sh/bun",
    score: 10, comment_count: 2, created_at: iso(3600 * 1000),
    comments_url: "https://lobste.rs/s/abc", ...over,
  } as Parameters<typeof parseLobsters>[0][number];
}

test("parseLobsters keeps github stories, dedupes by id, drops non-github", () => {
  const stories = [
    story({ short_id: "a", url: "https://github.com/oven-sh/bun" }),
    story({ short_id: "a", url: "https://github.com/oven-sh/bun" }), // dup across feeds
    story({ short_id: "b", url: "https://example.com/blog" }), // no github
  ];
  const out = parseLobsters(stories, now - 7 * 24 * 3600 * 1000);
  assert.equal(out.length, 1);
  assert.equal(out[0].repoRef, "oven-sh/bun");
});

test("parseLobsters drops stories outside the time window", () => {
  const old = story({ short_id: "old", created_at: iso(30 * 24 * 3600 * 1000) });
  const out = parseLobsters([old], now - 7 * 24 * 3600 * 1000);
  assert.equal(out.length, 0);
});
