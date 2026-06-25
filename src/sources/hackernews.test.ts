import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHnStories, parseHnComments } from "./hackernews.js";

type StoryHit = Parameters<typeof parseHnStories>[0][number];
type CommentHit = Parameters<typeof parseHnComments>[0][number];

function storyHit(over: Partial<StoryHit> = {}): StoryHit {
  return {
    objectID: "1", title: "Show HN: a thing", url: "https://github.com/oven-sh/bun",
    author: "alice", points: 100, num_comments: 20, created_at_i: 1700000000,
    story_text: null, ...over,
  } as StoryHit;
}

function commentHit(over: Partial<CommentHit> = {}): CommentHit {
  return {
    objectID: "c1", author: "bob", points: null, created_at_i: 1700000001,
    comment_text: "have you tried https://github.com/astral-sh/ruff ?",
    story_id: 42, story_title: "Ask HN: best linters?", ...over,
  } as CommentHit;
}

test("parseHnStories attributes a story to the repo in its url/title", () => {
  const out = parseHnStories([storyHit()]);
  assert.equal(out.length, 1);
  assert.equal(out[0].repoRef, "oven-sh/bun");
  assert.equal(out[0].externalId, "1");
  assert.equal(out[0].points, 100);
});

test("parseHnStories drops stories with no github reference", () => {
  const out = parseHnStories([storyHit({ url: "https://example.com", title: "a blog post", story_text: null })]);
  assert.equal(out.length, 0);
});

test("parseHnComments surfaces repos mentioned in discussion (0 engagement)", () => {
  const out = parseHnComments([commentHit()]);
  assert.equal(out.length, 1);
  assert.equal(out[0].repoRef, "astral-sh/ruff");
  assert.equal(out[0].points, 0); // Algolia doesn't expose comment scores
  assert.equal(out[0].externalId, "hn-comment:42:astral-sh/ruff");
});

test("parseHnComments dedupes a repo cited across comments in the same story", () => {
  const out = parseHnComments([commentHit({ objectID: "c1" }), commentHit({ objectID: "c2" })]);
  assert.equal(out.length, 1); // one mention per (story, repo)
});

test("parseHnComments keeps the same repo from different stories separate", () => {
  const out = parseHnComments([
    commentHit({ objectID: "c1", story_id: 42 }),
    commentHit({ objectID: "c2", story_id: 99 }),
  ]);
  assert.equal(out.length, 2);
});

test("parseHnComments captures multiple distinct repos in one comment", () => {
  const out = parseHnComments([
    commentHit({ comment_text: "compare https://github.com/astral-sh/ruff and https://github.com/psf/black" }),
  ]);
  assert.deepEqual(out.map((m) => m.repoRef).sort(), ["astral-sh/ruff", "psf/black"]);
});
