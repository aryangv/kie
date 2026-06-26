import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreTools, type ToolFeatures } from "./score.js";
import type { SourceName } from "../types.js";

function feat(partial: Partial<ToolFeatures> & { toolId: number }): ToolFeatures {
  return {
    stars: 100,
    ageHours: 240,
    distinctSources: new Set<SourceName>(["hackernews"]),
    mentionCount: 1,
    engagementRaw: 10,
    hoursSinceLastMention: 12,
    ...partial,
  };
}

test("scores are bounded 0..100 and sub-scores 0..1", () => {
  const scores = scoreTools([feat({ toolId: 1 }), feat({ toolId: 2, stars: 5000 })]);
  for (const b of scores.values()) {
    assert.ok(b.score >= 0 && b.score <= 100, `score ${b.score} out of range`);
    for (const k of ["velocity", "breadth", "recency", "engagement", "established"] as const) {
      assert.ok(b[k] >= 0 && b[k] <= 1, `${k} ${b[k]} out of range`);
    }
  }
});

test("broader source coverage scores higher, all else equal", () => {
  const narrow = feat({ toolId: 1, distinctSources: new Set<SourceName>(["hackernews"]) });
  const broad = feat({
    toolId: 2,
    distinctSources: new Set<SourceName>(["hackernews", "reddit", "lobsters"]),
  });
  const scores = scoreTools([narrow, broad]);
  assert.ok(scores.get(2)!.breadth > scores.get(1)!.breadth);
  assert.ok(scores.get(2)!.score > scores.get(1)!.score);
});

test("full source coverage yields breadth 1", () => {
  const all = feat({
    toolId: 1,
    distinctSources: new Set<SourceName>([
      "hackernews",
      "reddit",
      "lobsters",
      "github-trending",
      "twitter",
    ]),
  });
  assert.equal(scoreTools([all]).get(1)!.breadth, 1);
});

test("breadth denominator follows the enabled source count", () => {
  const f = feat({
    toolId: 1,
    distinctSources: new Set<SourceName>(["hackernews", "reddit"]),
  });
  // 2 distinct sources out of 2 enabled => full breadth.
  assert.equal(scoreTools([f], { sourceCount: 2 }).get(1)!.breadth, 1);
  // Same 2 out of the default 5 => partial.
  assert.ok(scoreTools([f]).get(1)!.breadth < 1);
});

test("more recent mention scores higher on recency", () => {
  const recent = feat({ toolId: 1, hoursSinceLastMention: 1 });
  const stale = feat({ toolId: 2, hoursSinceLastMention: 240 });
  const scores = scoreTools([recent, stale]);
  assert.ok(scores.get(1)!.recency > scores.get(2)!.recency);
});

test("measured star velocity beats amortized when higher", () => {
  const slow = feat({ toolId: 1, stars: 100, ageHours: 2400 });
  const fast = feat({ toolId: 2, stars: 100, ageHours: 2400, starsDelta: 500 });
  const scores = scoreTools([slow, fast]);
  assert.ok(scores.get(2)!.velocity > scores.get(1)!.velocity);
});

test("velocity normalization is log-scaled so a viral outlier doesn't flatten the cohort", () => {
  const mid = feat({ toolId: 1, starsDelta: 50 });
  const outlier = feat({ toolId: 2, starsDelta: 50000 });
  const scores = scoreTools([mid, outlier]);
  // Outlier still ranks highest on velocity...
  assert.ok(scores.get(2)!.velocity > scores.get(1)!.velocity);
  // ...but a linear norm would crush the mid repo to ~0.001; log keeps it alive.
  assert.ok(scores.get(1)!.velocity > 0.3, `mid velocity ${scores.get(1)!.velocity} too flattened`);
});

test("established mode: proven stars beat a spiking newcomer", () => {
  const proven = feat({ toolId: 1, stars: 50000, starsDelta: 0, maintained: true });
  const newcomer = feat({ toolId: 2, stars: 200, starsDelta: 800, maintained: true });
  const est = scoreTools([proven, newcomer], { mode: "established" });
  assert.ok(
    est.get(1)!.score > est.get(2)!.score,
    "the proven repo should win the established profile despite zero momentum",
  );
  // The same two in trending mode let the surging newcomer compete on velocity.
  const tr = scoreTools([proven, newcomer], { mode: "trending" });
  assert.ok(tr.get(2)!.velocity > tr.get(1)!.velocity);
});

test("an unmaintained repo is damped on the established signal", () => {
  const stale = feat({ toolId: 1, stars: 50000, maintained: false });
  const fresh = feat({ toolId: 2, stars: 50000, maintained: true });
  const est = scoreTools([stale, fresh], { mode: "established" });
  assert.ok(
    est.get(2)!.established > est.get(1)!.established,
    "equal stars, but the maintained repo scores higher on established",
  );
});
