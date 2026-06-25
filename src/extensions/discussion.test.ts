import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../store/db.js";
import { summarizeDiscussion, annotateDiscussion } from "./discussion.js";
import type { Extension } from "./catalog.js";
import type { RawMention } from "../types.js";

test("summarizeDiscussion aggregates count, points, and distinct sources", () => {
  const sig = summarizeDiscussion([
    { source: "hackernews", points: 120 },
    { source: "reddit", points: 30 },
    { source: "hackernews", points: 10 },
  ]);
  assert.equal(sig.mentionCount, 3);
  assert.equal(sig.points, 160);
  assert.deepEqual([...sig.sources].sort(), ["hackernews", "reddit"]);
});

const mention = (over: Partial<RawMention> & { externalId: string }): RawMention => ({
  source: "hackernews",
  title: "t",
  url: "https://example.com",
  points: 50,
  createdAt: Math.floor(Date.now() / 1000),
  repoRef: "acme/agents",
  ...over,
});

const ext = (over: Partial<Extension> & { id: string }): Extension => ({
  kind: "subagent",
  name: over.id,
  description: "d",
  url: "https://example.com",
  relevantCategories: [],
  match: [over.id],
  install: ["x"],
  why: "because",
  ...over,
});

test("annotateDiscussion attaches the store's mention signal by repoRef", () => {
  const store = new Store(":memory:");
  const now = Math.floor(Date.now() / 1000);
  const id = store.upsertTool("acme/agents", "https://github.com/acme/agents", "agents", now);
  store.insertMention(mention({ externalId: "hn1", points: 120 }), id);
  store.insertMention(mention({ externalId: "r1", source: "reddit", points: 40 }), id);

  const discussed = ext({ id: "gh:acme/agents:writer", repoRef: "acme/agents" });
  const quiet = ext({ id: "gh:other/repo:x", repoRef: "other/repo" });
  const curated = ext({ id: "skill:docx" }); // no repoRef

  annotateDiscussion([discussed, quiet, curated], store);

  assert.ok(discussed.discussion, "repo with mentions gets a signal");
  assert.equal(discussed.discussion!.mentionCount, 2);
  assert.equal(discussed.discussion!.points, 160);
  assert.equal(quiet.discussion, undefined, "repo with no mentions stays undefined");
  assert.equal(curated.discussion, undefined, "curated (no repoRef) is skipped");
  store.close();
});

test("annotateDiscussion clears a stale signal when the repo no longer has mentions", () => {
  const store = new Store(":memory:");
  // A reused catalog object that already carries a signal from a previous pass.
  const reused = ext({
    id: "gh:gone/repo:x",
    repoRef: "gone/repo",
    discussion: { mentionCount: 9, points: 999, sources: ["hackernews"] },
  });
  // No tool/mentions for "gone/repo" in this store.
  annotateDiscussion([reused], store);
  assert.equal(reused.discussion, undefined, "stale signal is overwritten, not kept");
  store.close();
});
