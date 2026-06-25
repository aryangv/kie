import { test } from "node:test";
import assert from "node:assert/strict";
import { recommendExtensions, mergeExtensions, popularityScore } from "./recommend.js";
import { CURATED_EXTENSIONS, type Extension } from "./catalog.js";
import type { ProfileView } from "../profile/profile.js";

function profile(categories: string[]): ProfileView {
  return {
    languages: new Set(["typescript"]),
    categoryIncumbents: new Map(categories.map((c) => [c, ["x"]])),
    rows: [],
    isEmpty: false,
  };
}

const ext = (over: Partial<Extension> & { id: string }): Extension => ({
  kind: "mcp-server",
  name: over.id,
  description: "d",
  url: "https://example.com",
  relevantCategories: [],
  match: [over.id],
  install: ["cmd"],
  why: "because",
  ...over,
});

test("universal extensions are recommended regardless of stack", () => {
  const recs = recommendExtensions([ext({ id: "filesystem", universal: true })], profile([]), new Set());
  assert.equal(recs[0].status, "recommend");
});

test("category-matched extensions are recommended; unmatched are optional", () => {
  const exts = [
    ext({ id: "postgres", relevantCategories: ["database"] }),
    ext({ id: "puppeteer", relevantCategories: ["ui-framework"] }),
  ];
  const recs = recommendExtensions(exts, profile(["database"]), new Set());
  const pg = recs.find((r) => r.ext.id === "postgres")!;
  const pp = recs.find((r) => r.ext.id === "puppeteer")!;
  assert.equal(pg.status, "recommend");
  assert.equal(pp.status, "optional");
});

test("installed extensions are detected via match aliases and skipped", () => {
  const e = ext({ id: "github", universal: true, match: ["github", "@modelcontextprotocol/server-github"] });
  const recs = recommendExtensions([e], profile([]), new Set(["@modelcontextprotocol/server-github"]));
  assert.equal(recs[0].status, "installed");
});

test("bundled (ships-with-Claude-Code) skills aren't pitched as 'worth adding'", () => {
  // Not filesystem-detected (empty installed set), but bundled -> treat as built-in.
  const docx = ext({ id: "skill:docx", kind: "skill", universal: true, bundled: true, match: ["docx"] });
  const recs = recommendExtensions([docx], profile([]), new Set());
  assert.equal(recs[0].status, "installed");
  assert.match(recs[0].reason, /ships with claude code/i);
});

test("a bundled skill that IS detected on disk still reads as installed", () => {
  const docx = ext({ id: "skill:docx", kind: "skill", bundled: true, match: ["docx"] });
  const recs = recommendExtensions([docx], profile([]), new Set(["docx"]));
  assert.equal(recs[0].status, "installed");
});

test("discovered items need a SPECIFIC category — broad-only (ai-tool) is demoted", () => {
  const broadOnly = ext({ id: "gh:x/seo", discovered: true, relevantCategories: ["ai-tool"], stars: 9000 });
  const specific = ext({ id: "gh:x/dbtool", discovered: true, relevantCategories: ["database"], stars: 100 });
  // profile covers both ai-tool and database.
  const recs = recommendExtensions([broadOnly, specific], profile(["ai-tool", "database"]), new Set());
  assert.equal(recs.find((r) => r.ext.id === "gh:x/seo")!.status, "optional");
  assert.equal(recs.find((r) => r.ext.id === "gh:x/dbtool")!.status, "recommend");
});

test("curated items still recommend on a broad-only match (hand-vetted)", () => {
  const curatedBroad = ext({ id: "skill:sc", relevantCategories: ["ai-tool"] }); // discovered=false
  const recs = recommendExtensions([curatedBroad], profile(["ai-tool"]), new Set());
  assert.equal(recs[0].status, "recommend");
});

test("discovered items are capped by maxDiscovered, ranked by stars", () => {
  const many = [1, 2, 3, 4, 5].map((n) =>
    ext({ id: `gh:x/r${n}`, discovered: true, relevantCategories: ["database"], stars: n * 10 }),
  );
  const recs = recommendExtensions(many, profile(["database"]), new Set(), { maxDiscovered: 2 });
  const shown = recs.filter((r) => r.ext.discovered).map((r) => r.ext.stars);
  assert.deepEqual(shown, [50, 40]); // top 2 by stars, rest dropped
});

test("discovered subagents recommend on popularity even without a stack match; matches rank first", () => {
  const generic = ext({
    id: "gh:acme/agents:writer",
    kind: "subagent",
    discovered: true,
    relevantCategories: [], // no stack tie at all
    stars: 5000,
    sourceRepo: "acme/agents",
  });
  const dbMatch = ext({
    id: "gh:acme/agents:migrator",
    kind: "subagent",
    discovered: true,
    relevantCategories: ["database"],
    stars: 100,
  });
  const recs = recommendExtensions([generic, dbMatch], profile(["database"]), new Set());
  // Popularity carries: BOTH are recommended (this is the "for everyone" rule).
  assert.equal(recs.find((r) => r.ext.id === generic.id)!.status, "recommend");
  assert.equal(recs.find((r) => r.ext.id === dbMatch.id)!.status, "recommend");
  // But the stack-matched one ranks ahead of the higher-starred generic one.
  const order = recs.map((r) => r.ext.id);
  assert.ok(order.indexOf(dbMatch.id) < order.indexOf(generic.id), "stack match ranks first");
});

test("popularityScore blends stars with discussion heat; no discussion = stars", () => {
  assert.equal(popularityScore({ stars: 1000 }), 1000);
  // 100 points + 2 mentions*10 = 120 heat * 50 = 6000 boost.
  assert.equal(
    popularityScore({ stars: 1000, discussion: { mentionCount: 2, points: 100, sources: ["hackernews"] } }),
    7000,
  );
});

test("discussion heat lifts a talked-about subagent above a higher-starred quiet one", () => {
  const quiet = ext({ id: "gh:a/quiet:x", kind: "subagent", discovered: true, stars: 5000 });
  const buzzy = ext({
    id: "gh:b/buzzy:y",
    kind: "subagent",
    discovered: true,
    stars: 800,
    discussion: { mentionCount: 3, points: 250, sources: ["hackernews", "reddit"] },
  });
  const recs = recommendExtensions([quiet, buzzy], profile([]), new Set());
  const order = recs.map((r) => r.ext.id);
  assert.ok(order.indexOf(buzzy.id) < order.indexOf(quiet.id), "buzz outranks raw stars here");
});

test("discovered subagents have their own cap, separate from other discovered items", () => {
  const subs = [1, 2, 3].map((n) =>
    ext({ id: `gh:s/r:${n}`, kind: "subagent", discovered: true, stars: n * 10 }),
  );
  const mcps = [1, 2, 3].map((n) =>
    ext({ id: `gh:m/r${n}`, kind: "mcp-server", discovered: true, relevantCategories: ["database"], stars: n }),
  );
  const recs = recommendExtensions([...subs, ...mcps], profile(["database"]), new Set(), {
    maxDiscoveredSubagents: 2,
    maxDiscovered: 1,
  });
  const shownSubs = recs.filter((r) => r.ext.kind === "subagent");
  const shownMcps = recs.filter((r) => r.ext.kind === "mcp-server");
  assert.equal(shownSubs.length, 2, "subagent lane capped at 2");
  assert.equal(shownMcps.length, 1, "other-discovered lane capped at 1");
});

test("curated subagents: universal ones always recommend, stack-specific ones gate on profile", () => {
  const subagents = CURATED_EXTENSIONS.filter((e) => e.kind === "subagent");
  // Sanity: the catalog actually carries a meaningful set now (not just one).
  assert.ok(subagents.length >= 8, `expected a rich subagent catalog, got ${subagents.length}`);

  const status = (recs: ReturnType<typeof recommendExtensions>, id: string) =>
    recs.find((r) => r.ext.id === id)!.status;

  // Empty profile: universal subagents recommend; stack-specific ones don't.
  const empty = recommendExtensions(subagents, profile([]), new Set());
  assert.equal(status(empty, "subagent:code-reviewer"), "recommend");
  assert.equal(status(empty, "subagent:debugger"), "recommend");
  assert.equal(status(empty, "subagent:db-migrator"), "optional");
  assert.equal(status(empty, "subagent:test-writer"), "optional");

  // A DB/test-heavy profile pulls the matching subagents into "recommend".
  const stacked = recommendExtensions(subagents, profile(["database", "orm", "testing"]), new Set());
  assert.equal(status(stacked, "subagent:db-migrator"), "recommend");
  assert.equal(status(stacked, "subagent:test-writer"), "recommend");

  // Already-installed subagents are skipped via match aliases.
  const installed = recommendExtensions(subagents, profile([]), new Set(["reviewer"]));
  assert.equal(status(installed, "subagent:code-reviewer"), "installed");
});

test("mergeExtensions de-dupes by id, curated wins", () => {
  const curated = [ext({ id: "gh:a/b", name: "curated" })];
  const discovered = [ext({ id: "gh:a/b", name: "discovered" }), ext({ id: "gh:c/d", name: "new" })];
  const merged = mergeExtensions(curated, discovered);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((e) => e.id === "gh:a/b")!.name, "curated");
});
