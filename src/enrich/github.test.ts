import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichManyWith } from "./github.js";
import type { RepoMeta } from "../types.js";

function metaFor(repoRef: string): RepoMeta {
  return {
    repoRef,
    url: `https://github.com/${repoRef}`,
    name: repoRef.split("/")[1],
    owner: repoRef.split("/")[0],
    description: "d",
    language: "TypeScript",
    topics: [],
    stars: 1,
    forks: 0,
    pushedAt: null,
    readme: null,
    fetchedAt: 0,
  };
}

test("enrichManyWith delivers every resolved repo and counts them", async () => {
  const refs = ["a/1", "b/2", "c/3"];
  const seen: string[] = [];
  const res = await enrichManyWith(refs, async (r) => metaFor(r), (m) => seen.push(m.repoRef));
  assert.equal(res.enriched, 3);
  assert.equal(res.skipped, 0);
  assert.deepEqual([...seen].sort(), ["a/1", "b/2", "c/3"]);
});

test("enrichManyWith isolates 404s (null) and throws as skipped", async () => {
  const refs = ["ok/1", "missing/2", "boom/3", "ok/4"];
  const delivered: string[] = [];
  const res = await enrichManyWith(
    refs,
    async (r) => {
      if (r === "missing/2") return null;
      if (r === "boom/3") throw new Error("network");
      return metaFor(r);
    },
    (m) => delivered.push(m.repoRef),
  );
  assert.equal(res.enriched, 2);
  assert.equal(res.skipped, 2);
  assert.deepEqual([...delivered].sort(), ["ok/1", "ok/4"]);
});

test("enrichManyWith never exceeds the concurrency limit", async () => {
  const refs = Array.from({ length: 20 }, (_, i) => `r/${i}`);
  let active = 0;
  let peak = 0;
  const res = await enrichManyWith(
    refs,
    async (r) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return metaFor(r);
    },
    () => {},
    4,
  );
  assert.equal(res.enriched, 20);
  assert.ok(peak <= 4, `peak concurrency ${peak} should be <= 4`);
  assert.ok(peak > 1, "should actually run in parallel");
});

test("enrichManyWith handles an empty batch", async () => {
  const res = await enrichManyWith([], async (r) => metaFor(r), () => {});
  assert.deepEqual(res, { enriched: 0, skipped: 0 });
});
