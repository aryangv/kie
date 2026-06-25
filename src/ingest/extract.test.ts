import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRepoRefs, firstRepoRef, splitRef } from "./extract.js";

test("extracts a plain github url", () => {
  assert.deepEqual(extractRepoRefs("check out https://github.com/oven-sh/bun today"), [
    "oven-sh/bun",
  ]);
});

test("normalizes case and dedupes", () => {
  const refs = extractRepoRefs("github.com/Oven-Sh/Bun and https://github.com/oven-sh/bun");
  assert.deepEqual(refs, ["oven-sh/bun"]);
});

test("strips .git suffix and trailing path", () => {
  assert.deepEqual(extractRepoRefs("clone https://github.com/foo/bar.git"), ["foo/bar"]);
  assert.deepEqual(extractRepoRefs("https://github.com/foo/bar/tree/main/src"), ["foo/bar"]);
});

test("ignores reserved site paths", () => {
  assert.deepEqual(extractRepoRefs("https://github.com/trending"), []);
  assert.deepEqual(extractRepoRefs("https://github.com/features/copilot"), []);
  assert.deepEqual(extractRepoRefs("https://github.com/sponsors/someone"), []);
});

test("handles multiple distinct repos", () => {
  const refs = extractRepoRefs(
    "compare github.com/a/one with github.com/b/two and github.com/a/one",
  );
  assert.deepEqual(refs.sort(), ["a/one", "b/two"]);
});

test("firstRepoRef returns undefined when none", () => {
  assert.equal(firstRepoRef("no links here"), undefined);
});

test("strips trailing punctuation from repo name", () => {
  assert.deepEqual(extractRepoRefs("see (https://github.com/foo/bar)."), ["foo/bar"]);
});

test("splitRef splits owner and name", () => {
  assert.deepEqual(splitRef("oven-sh/bun"), { owner: "oven-sh", name: "bun" });
});
