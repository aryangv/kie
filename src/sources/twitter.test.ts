import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTweets, TwitterSource } from "./twitter.js";

type Resp = Parameters<typeof parseTweets>[0];
const now = Math.floor(Date.now() / 1000);
const iso = (secAgo: number) => new Date((now - secAgo) * 1000).toISOString();

function tweet(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    text: "great new tool, check it out",
    created_at: iso(3600),
    public_metrics: { like_count: 30, retweet_count: 10, reply_count: 4 },
    entities: { urls: [{ expanded_url: "https://github.com/oven-sh/bun" }] },
    ...over,
  };
}
const resp = (data: ReturnType<typeof tweet>[]): Resp => ({ data } as Resp);

test("parseTweets pulls the repo from expanded entity URLs (not the t.co text)", () => {
  const out = parseTweets(resp([tweet({ text: "amazing → https://t.co/abc123" })]), now - 7 * 24 * 3600);
  assert.equal(out.length, 1);
  assert.equal(out[0].repoRef, "oven-sh/bun");
  assert.equal(out[0].source, "twitter");
  assert.equal(out[0].points, 40); // likes + retweets
  assert.equal(out[0].comments, 4);
});

test("parseTweets prefers unwound_url when present", () => {
  const out = parseTweets(
    resp([tweet({ entities: { urls: [{ expanded_url: "https://t.co/x", unwound_url: "https://github.com/astral-sh/ruff" }] } })]),
    now - 7 * 24 * 3600,
  );
  assert.equal(out[0]?.repoRef, "astral-sh/ruff");
});

test("parseTweets drops out-of-window and repo-less tweets", () => {
  const out = parseTweets(
    resp([
      tweet({ id: "old", created_at: iso(30 * 24 * 3600) }),
      tweet({ id: "norepo", entities: { urls: [{ expanded_url: "https://example.com" }] }, text: "no repo here" }),
    ]),
    now - 7 * 24 * 3600,
  );
  assert.equal(out.length, 0);
});

test("parseTweets handles an empty response", () => {
  assert.deepEqual(parseTweets({}, now - 7 * 24 * 3600), []);
});

test("TwitterSource.isEnabled reflects bearer-token presence", () => {
  const { X_BEARER_TOKEN: x, TWITTER_BEARER_TOKEN: t } = process.env;
  try {
    delete process.env.X_BEARER_TOKEN;
    delete process.env.TWITTER_BEARER_TOKEN;
    assert.equal(new TwitterSource().isEnabled(), false);
    process.env.TWITTER_BEARER_TOKEN = "abc";
    assert.equal(new TwitterSource().isEnabled(), true);
  } finally {
    x === undefined ? delete process.env.X_BEARER_TOKEN : (process.env.X_BEARER_TOKEN = x);
    t === undefined ? delete process.env.TWITTER_BEARER_TOKEN : (process.env.TWITTER_BEARER_TOKEN = t);
  }
});
