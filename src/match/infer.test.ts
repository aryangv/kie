import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recencyWeight,
  inferCategoriesByCooccurrence,
  inferArchetypes,
  RECENCY_HALF_LIFE_DAYS,
  MAX_COOCCURRENCE_CONFIDENCE,
} from "./infer.js";

const DAY = 86400;

test("recencyWeight: 1.0 now, ~0.5 at one half-life, floored, never above 1", () => {
  const now = 1_000_000_000;
  assert.equal(recencyWeight(now, now), 1);
  assert.equal(recencyWeight(null, now), 1, "missing time = full weight");
  assert.equal(recencyWeight(now + DAY, now), 1, "future time clamped to 1");
  const half = recencyWeight(now - RECENCY_HALF_LIFE_DAYS * DAY, now);
  assert.ok(Math.abs(half - 0.5) < 1e-9, `half-life ~0.5, got ${half}`);
  const ancient = recencyWeight(now - 10_000 * DAY, now);
  assert.ok(ancient > 0 && ancient <= 0.05, "very old decays to the floor, not zero");
});

test("recencyWeight is monotonic — older never outweighs newer", () => {
  const now = 2_000_000_000;
  const recent = recencyWeight(now - 5 * DAY, now);
  const older = recencyWeight(now - 200 * DAY, now);
  assert.ok(recent > older);
});

test("co-occurrence infers an unknown dep from the categories it ships with", () => {
  // `mysteryui` always appears alongside react (ui-framework) + vite (bundler).
  const categoryOf = (d: string) =>
    ({ react: "ui-framework", vite: "bundler", jest: "testing" } as Record<string, string>)[d];
  const inferred = inferCategoriesByCooccurrence({
    repos: [
      { deps: ["react", "vite", "mysteryui"] },
      { deps: ["react", "jest", "mysteryui"] },
    ],
    categoryOf,
  });
  const got = inferred.get("mysteryui");
  assert.ok(got, "mysteryui inferred");
  assert.equal(got!.category, "ui-framework", "dominant co-occurring category");
  assert.ok(got!.confidence > 0 && got!.confidence <= MAX_COOCCURRENCE_CONFIDENCE);
  assert.ok(got!.confidence < 0.75, "stays below the incumbent bar");
});

test("co-occurrence stays conservative below the support floor", () => {
  const categoryOf = (d: string) => (d === "react" ? "ui-framework" : undefined);
  const inferred = inferCategoriesByCooccurrence({
    repos: [{ deps: ["react", "loner"] }], // only one repo of support
    categoryOf,
  });
  assert.equal(inferred.has("loner"), false, "single-repo support is not enough");
});

test("co-occurrence skips deps with no known anchors in their repos", () => {
  const inferred = inferCategoriesByCooccurrence({
    repos: [{ deps: ["a", "b"] }, { deps: ["a", "c"] }],
    categoryOf: () => undefined, // nothing recognized
  });
  assert.equal(inferred.size, 0);
});

test("inferArchetypes rolls categories up into ranked personas", () => {
  const strength = new Map<string, number>([
    ["ui-framework", 3],
    ["css", 2],
    ["bundler", 1],
    ["orm", 0.5],
  ]);
  const arch = inferArchetypes(strength);
  assert.ok(arch.length >= 2);
  assert.equal(arch[0].name, "frontend", "frontend dominates");
  assert.ok(arch[0].categories.includes("ui-framework"));
  assert.ok(arch.some((a) => a.name === "backend"), "orm still surfaces backend");
  // Sorted by score descending.
  assert.ok(arch[0].score >= arch[1].score);
});

test("inferArchetypes returns nothing for an empty stack", () => {
  assert.deepEqual(inferArchetypes(new Map()), []);
});
