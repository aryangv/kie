import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../store/db.js";
import { ensureProfileFresh, rebuildProfile, recordDecision } from "./profile.js";
import type { ScannedSignal } from "./scanner.js";

function sig(
  repoPath: string,
  manifest: string,
  dependency: string,
  language: string,
  mtime?: number,
): ScannedSignal {
  return { repoPath, manifest, dependency, language, mtime };
}

test("rebuildProfile derives languages and category incumbents", () => {
  const store = new Store(":memory:");
  const signals = [
    sig("app1", "package.json", "react", "javascript"),
    sig("app1", "package.json", "jest", "javascript"),
    sig("app1", "package.json", "typescript", "typescript"),
    sig("app2", "package.json", "react", "javascript"),
  ];
  const view = rebuildProfile(store, signals);

  assert.ok(view.languages.has("typescript"), "typescript detected via dep");
  assert.deepEqual(view.categoryIncumbents.get("testing"), ["jest"]);
  assert.deepEqual(view.categoryIncumbents.get("ui-framework"), ["react"]);
  store.close();
});

test("recency weighting: a stale repo contributes less than a fresh one", () => {
  const store = new Store(":memory:");
  const now = Math.floor(Date.now() / 1000);
  const old = now - 120 * 86400; // two ~60-day half-lives back
  const view = rebuildProfile(store, [
    sig("fresh", "package.json", "react", "javascript", now),
    sig("stale", "package.json", "react", "javascript", old),
  ]);
  const reactRow = view.rows.find((r) => r.key === "library:react")!;
  // fresh(=1) + stale(~0.25) — well under the old "2 repos = weight 2".
  assert.ok(reactRow.weight > 1 && reactRow.weight < 1.6, `weight ${reactRow.weight}`);
  const strength = view.categoryStrength!.get("ui-framework")!;
  assert.ok(strength > 1 && strength < 1.6, `strength ${strength}`);
  store.close();
});

test("co-occurrence infers an unknown dep without making it an incumbent", () => {
  const store = new Store(":memory:");
  const view = rebuildProfile(store, [
    sig("app1", "package.json", "react", "javascript"),
    sig("app1", "package.json", "vite", "javascript"),
    sig("app1", "package.json", "mysteryui", "javascript"),
    sig("app2", "package.json", "react", "javascript"),
    sig("app2", "package.json", "jest", "javascript"),
    sig("app2", "package.json", "mysteryui", "javascript"),
  ]);
  const row = view.rows.find((r) => r.key === "library:mysteryui")!;
  assert.equal(row.category, "ui-framework", "inferred from co-occurring react");
  assert.ok(row.confidence < 1, "marked as an inference, not observed");
  // It enriches strength but is NOT presented as an incumbent (no spurious "replaces").
  assert.ok(!view.categoryIncumbents.get("ui-framework")!.includes("mysteryui"));
  assert.ok(view.categoryIncumbents.get("ui-framework")!.includes("react"));
  store.close();
});

test("unknown deps with no inferable category are retained, not dropped", () => {
  const store = new Store(":memory:");
  const view = rebuildProfile(store, [
    sig("solo", "package.json", "react", "javascript"),
    sig("solo", "package.json", "weirdlib", "javascript"), // 1-repo support: not inferable
  ]);
  assert.ok(view.uncategorized!.includes("weirdlib"), "raw tail surfaced");
  assert.ok(view.rows.some((r) => r.key === "library:weirdlib" && r.category === null));
  store.close();
});

test("archetypes roll up from the scanned stack", () => {
  const store = new Store(":memory:");
  const view = rebuildProfile(store, [
    sig("web", "package.json", "react", "javascript"),
    sig("web", "package.json", "vite", "javascript"),
    sig("web", "package.json", "tailwindcss", "javascript"),
  ]);
  assert.ok(view.archetypes!.some((a) => a.name === "frontend"), "frontend persona inferred");
  store.close();
});

test("recordDecision learns +/- affinities per category and language", () => {
  const store = new Store(":memory:");
  const now = Math.floor(Date.now() / 1000);
  const id = store.upsertTool("a/t1", "https://github.com/a/t1", "t1", now);
  store.applyRepoMeta(id, {
    repoRef: "a/t1", url: "https://github.com/a/t1", name: "t1", owner: "a",
    description: "a test runner", language: "Rust", topics: ["testing"],
    stars: 1, forks: 0, pushedAt: now, readme: null, fetchedAt: now,
  });
  const accepted = recordDecision(store, store.getTool(id)!, "accepted");
  assert.equal(accepted.affinities!.get("testing"), 1, "accept nudges +1");
  assert.equal(accepted.affinities!.get("rust"), 1, "language affinity learned");

  const id2 = store.upsertTool("a/t2", "https://github.com/a/t2", "t2", now);
  store.applyRepoMeta(id2, {
    repoRef: "a/t2", url: "https://github.com/a/t2", name: "t2", owner: "a",
    description: "another test runner", language: "Rust", topics: ["testing"],
    stars: 1, forks: 0, pushedAt: now, readme: null, fetchedAt: now,
  });
  const rejected = recordDecision(store, store.getTool(id2)!, "rejected");
  assert.equal(rejected.affinities!.get("testing"), 0, "reject cancels the prior accept");
  store.close();
});

test("recordDecision(installed) adds tool categories to profile", () => {
  const store = new Store(":memory:");
  const now = Math.floor(Date.now() / 1000);
  const id = store.upsertTool("oven-sh/bun", "https://github.com/oven-sh/bun", "bun", now);
  store.applyRepoMeta(id, {
    repoRef: "oven-sh/bun", url: "https://github.com/oven-sh/bun", name: "bun", owner: "oven-sh",
    description: "A bundler and test runner", language: "Zig", topics: ["bundler", "testing"],
    stars: 1, forks: 0, pushedAt: now, readme: null, fetchedAt: now,
  });
  const tool = store.getTool(id)!;
  const view = recordDecision(store, tool, "installed");

  assert.ok(view.categoryIncumbents.has("bundler"));
  assert.ok(view.categoryIncumbents.has("testing"));
  assert.equal(store.getDecision(id)?.decision, "installed");
  store.close();
});

test("ensureProfileFresh scans when empty/stale and skips when fresh", () => {
  // Point scans at an empty temp dir so the rescan is deterministic.
  const emptyRoot = mkdtempSync(join(tmpdir(), "ts-roots-"));
  const prev = process.env.KIE_CODE_ROOTS;
  process.env.KIE_CODE_ROOTS = emptyRoot;
  try {
    const store = new Store(":memory:");
    const now = Math.floor(Date.now() / 1000);

    // Never scanned -> ensureProfileFresh must run a scan and stamp the time.
    ensureProfileFresh(store);
    assert.ok(store.getMeta("lastProfileScan"), "scan ran on first use");

    // Fresh: plant a library row, mark scanned now, expect NO rescan (row stays).
    store.upsertProfileRow({ key: "library:react", kind: "library", label: "react", category: "ui-framework", weight: 1, now });
    store.setMeta("lastProfileScan", String(now));
    const fresh = ensureProfileFresh(store, 24);
    assert.ok(fresh.categoryIncumbents.has("ui-framework"), "fresh profile left untouched");

    // Stale: backdate the scan; ensureProfileFresh rescans the empty dir, which
    // clears library rows.
    store.setMeta("lastProfileScan", String(now - 48 * 3600));
    const rescanned = ensureProfileFresh(store, 24);
    assert.ok(!rescanned.categoryIncumbents.has("ui-framework"), "stale profile rescanned");
    store.close();
  } finally {
    if (prev === undefined) delete process.env.KIE_CODE_ROOTS;
    else process.env.KIE_CODE_ROOTS = prev;
  }
});
