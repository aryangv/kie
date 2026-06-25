import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, digestPath } from "./daemon.js";
import type { TrendingEntry } from "../types.js";

const now = Math.floor(Date.now() / 1000);

test("renderMarkdown reports up-to-date when there's nothing new", () => {
  const md = renderMarkdown([], now);
  assert.match(md, /what's new/i);
  assert.match(md, /up to date/i);
});

test("renderMarkdown lists items with repo, score, and reason", () => {
  const entry: TrendingEntry = {
    tool: {
      id: 1, repoRef: "a/b", url: "https://github.com/a/b", name: "b",
      description: "does things", language: "Go", topics: ["cli"], currentStars: 42, firstSeen: now,
    },
    breakdown: { velocity: 1, breadth: 1, recency: 1, engagement: 1, score: 88.8 },
    sources: ["hackernews"],
    mentionCount: 1,
    fit: { verdict: "complements", reason: "fills a gap in your stack", related: [] },
  };
  const md = renderMarkdown([entry], now);
  assert.match(md, /a\/b/);
  assert.match(md, /88\.8/);
  assert.match(md, /fills a gap/);
});

test("digestPath honors KIE_DIGEST_PATH override", () => {
  const prev = process.env.KIE_DIGEST_PATH;
  process.env.KIE_DIGEST_PATH = "/tmp/custom-digest.md";
  try {
    assert.equal(digestPath(), "/tmp/custom-digest.md");
  } finally {
    if (prev === undefined) delete process.env.KIE_DIGEST_PATH;
    else process.env.KIE_DIGEST_PATH = prev;
  }
});
