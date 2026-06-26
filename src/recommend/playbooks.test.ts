import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLAYBOOKS,
  matchPlaybook,
  isMaintained,
  MAINTAINED_MAX_AGE_SEC,
  type Playbook,
} from "./playbooks.js";
import { formatPlaybook, formatPlaybookMenu } from "../mcp/format.js";

test("matchPlaybook resolves the token-usage goal across phrasings", () => {
  for (const goal of [
    "I want to reduce my token usage",
    "how do I make claude code cheaper",
    "my context window keeps filling up",
    "trim my usage",
  ]) {
    const pb = matchPlaybook(goal);
    assert.ok(pb, `expected a match for: ${goal}`);
    assert.equal(pb!.goal, "reduce-token-usage");
  }
});

test("matchPlaybook returns undefined when nothing matches", () => {
  assert.equal(matchPlaybook("I want to learn the violin"), undefined);
  assert.equal(matchPlaybook(""), undefined);
});

test("single-word triggers match whole words, not substrings", () => {
  // "tokenizer" should NOT fire the bare "token" trigger (word-boundary match).
  const fake: Playbook[] = [
    { id: "p", goal: "g", title: "T", match: ["token"], summary: "", options: [] },
  ];
  assert.equal(matchPlaybook("building a tokenizer library", fake), undefined);
  assert.ok(matchPlaybook("reduce token spend", fake));
});

test("multi-word triggers match as a phrase", () => {
  const fake: Playbook[] = [
    { id: "p", goal: "g", title: "T", match: ["context window"], summary: "", options: [] },
  ];
  assert.ok(matchPlaybook("my context window is full", fake));
  // The individual words alone, out of phrase order, shouldn't match the phrase trigger.
  assert.equal(matchPlaybook("window into the context of things", fake), undefined);
});

test("the best-scoring playbook wins when several match", () => {
  const a: Playbook = { id: "a", goal: "a", title: "A", match: ["speed"], summary: "", options: [] };
  const b: Playbook = {
    id: "b", goal: "b", title: "B", match: ["speed", "fast", "ci"], summary: "", options: [],
  };
  assert.equal(matchPlaybook("speed up fast ci", [a, b])!.id, "b");
});

test("isMaintained: fresh true, stale false, unknown undefined", () => {
  const now = 1_700_000_000;
  assert.equal(isMaintained(now - 10, now), true);
  assert.equal(isMaintained(now - MAINTAINED_MAX_AGE_SEC - 1, now), false);
  assert.equal(isMaintained(null, now), undefined);
  assert.equal(isMaintained(undefined, now), undefined);
});

test("the curated token playbook has both built-in and repo-backed options", () => {
  const pb = PLAYBOOKS.find((p) => p.goal === "reduce-token-usage")!;
  assert.ok(pb.options.some((o) => o.builtin), "expected at least one built-in option");
  assert.ok(pb.options.some((o) => o.repoRef), "expected at least one repo-backed option");
  assert.ok(pb.discoverQuery, "token playbook should drive a discovery query");
  for (const o of pb.options) {
    assert.ok(o.pros.length && o.cons.length && o.how.length, `${o.name} needs pros/cons/how`);
  }
});

test("formatPlaybook renders pros/cons/how and the live-signal flags", () => {
  const pb: Playbook = {
    id: "p", goal: "g", title: "Reduce token usage", match: [], summary: "Spend fewer tokens.",
    options: [],
  };
  const out = formatPlaybook(pb, [
    {
      name: "Subagents", what: "Isolate context.", builtin: true,
      pros: ["Big lever"], cons: ["Setup cost"], how: ["Make .claude/agents/*.md"],
    },
    {
      name: "some-tool", what: "A community tool.", discovered: true, repoRef: "x/some-tool",
      url: "https://github.com/x/some-tool", stars: 1234, maintained: false,
      discussion: { mentionCount: 2, points: 50, sources: ["hackernews"] },
      pros: ["Popular"], cons: ["Unvetted"], how: ["See repo"],
    },
  ]);
  assert.match(out, /Goal: Reduce token usage/);
  assert.match(out, /\[built-in\]/);
  assert.match(out, /⚠ community — verify/);
  assert.match(out, /Pros:/);
  assert.match(out, /\+ Big lever/);
  assert.match(out, /- Setup cost/);
  assert.match(out, /★ 1,234/);
  assert.match(out, /💬 HN \(2 mentions, 50 pts\)/);
  assert.match(out, /looks unmaintained/);
});

test("formatPlaybookMenu lists the known goals", () => {
  const out = formatPlaybookMenu(PLAYBOOKS);
  assert.match(out, /Reduce token usage/);
  assert.match(out, /don't have a curated playbook/i);
});
