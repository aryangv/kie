import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFit } from "./fit.js";
import type { ProfileView } from "../profile/profile.js";
import type { Tool } from "../types.js";

function tool(p: Partial<Tool> & { repoRef: string }): Tool {
  return {
    id: 1,
    url: `https://github.com/${p.repoRef}`,
    name: p.repoRef.split("/")[1],
    description: null,
    language: null,
    topics: [],
    currentStars: 0,
    firstSeen: 0,
    ...p,
  };
}

function profile(p: Partial<ProfileView>): ProfileView {
  return {
    languages: new Set(["typescript"]),
    categoryIncumbents: new Map(),
    rows: [{ key: "language:typescript", kind: "language", label: "TypeScript", category: null, weight: 2, updated_at: 0 }],
    isEmpty: false,
    ...p,
  };
}

test("REPLACES when category already covered", () => {
  const p = profile({ categoryIncumbents: new Map([["testing", ["jest"]]]) });
  const v = classifyFit(tool({ repoRef: "vitest-dev/vitest", name: "vitest", language: "TypeScript" }), p);
  assert.equal(v.verdict, "replaces");
  assert.ok(v.related.some((r) => r.includes("jest")));
});

test("COMPLEMENTS when in-language and gap not covered", () => {
  const p = profile({ categoryIncumbents: new Map([["testing", ["jest"]]]) });
  const v = classifyFit(tool({ repoRef: "drizzle-team/drizzle-orm", name: "drizzle-orm", language: "TypeScript" }), p);
  assert.equal(v.verdict, "complements");
});

test("IRRELEVANT when wrong language and not agnostic", () => {
  const p = profile({});
  const v = classifyFit(tool({ repoRef: "actix/actix-web", name: "actix-web", language: "Rust" }), p);
  assert.equal(v.verdict, "irrelevant");
});

test("COMPLEMENTS for language-agnostic tooling despite language mismatch", () => {
  const p = profile({});
  const v = classifyFit(tool({ repoRef: "spf13/cobra", name: "cobra", language: "Go" }), p);
  assert.equal(v.verdict, "complements");
});

test("uncategorized repo is flagged uncertain (low confidence)", () => {
  const p = profile({});
  // No name/topic/description signal the taxonomy recognizes, wrong language.
  const v = classifyFit(
    tool({ repoRef: "obscure/widgetizer", name: "widgetizer", language: "Rust" }),
    p,
  );
  assert.equal(v.uncertain, true);
});

test("categorized repo is NOT uncertain", () => {
  const p = profile({ categoryIncumbents: new Map([["testing", ["jest"]]]) });
  const v = classifyFit(tool({ repoRef: "vitest-dev/vitest", name: "vitest", language: "TypeScript" }), p);
  assert.notEqual(v.uncertain, true);
});

test("empty profile yields a hedged complements", () => {
  const p = profile({ languages: new Set(), categoryIncumbents: new Map(), rows: [], isEmpty: true });
  const v = classifyFit(tool({ repoRef: "a/b", language: "Rust" }), p);
  assert.equal(v.verdict, "complements");
  assert.match(v.reason, /profile is empty/i);
});
