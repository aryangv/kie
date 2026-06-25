import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRedditListing, RedditSource } from "./reddit.js";

type Listing = Parameters<typeof parseRedditListing>[0];
const now = Math.floor(Date.now() / 1000);

function post(over: Record<string, unknown> = {}) {
  return {
    data: {
      id: "p1", title: "Check out this tool", url: "https://github.com/oven-sh/bun",
      permalink: "/r/programming/comments/p1/", author: "alice", score: 120,
      num_comments: 8, created_utc: now - 3600, selftext: "",
      ...over,
    },
  };
}
const listing = (children: ReturnType<typeof post>[]): Listing => ({ data: { children } } as Listing);

test("parseRedditListing keeps github posts and maps fields", () => {
  const out = parseRedditListing(listing([post()]), now - 7 * 24 * 3600);
  assert.equal(out.length, 1);
  assert.equal(out[0].repoRef, "oven-sh/bun");
  assert.equal(out[0].source, "reddit");
  assert.equal(out[0].points, 120);
  assert.equal(out[0].url, "https://www.reddit.com/r/programming/comments/p1/");
});

test("parseRedditListing drops non-github and out-of-window posts", () => {
  const out = parseRedditListing(
    listing([
      post({ id: "a", url: "https://example.com/blog", title: "a blog", selftext: "" }),
      post({ id: "b", created_utc: now - 30 * 24 * 3600 }), // too old
    ]),
    now - 7 * 24 * 3600,
  );
  assert.equal(out.length, 0);
});

test("parseRedditListing finds a repo mentioned in selftext", () => {
  const out = parseRedditListing(
    listing([post({ url: "https://reddit.com/self", selftext: "I love https://github.com/astral-sh/ruff" })]),
    now - 7 * 24 * 3600,
  );
  assert.equal(out[0]?.repoRef, "astral-sh/ruff");
});

test("RedditSource.isEnabled reflects credential presence", () => {
  const { REDDIT_CLIENT_ID: id, REDDIT_CLIENT_SECRET: secret } = process.env;
  try {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    assert.equal(new RedditSource().isEnabled(), false);
    process.env.REDDIT_CLIENT_ID = "x";
    process.env.REDDIT_CLIENT_SECRET = "y";
    assert.equal(new RedditSource().isEnabled(), true);
  } finally {
    id === undefined ? delete process.env.REDDIT_CLIENT_ID : (process.env.REDDIT_CLIENT_ID = id);
    secret === undefined ? delete process.env.REDDIT_CLIENT_SECRET : (process.env.REDDIT_CLIENT_SECRET = secret);
  }
});
