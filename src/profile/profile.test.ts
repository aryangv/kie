import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../store/db.js";
import { ensureProfileFresh, rebuildProfile, recordDecision } from "./profile.js";
import type { ScannedSignal } from "./scanner.js";

function sig(repoPath: string, manifest: string, dependency: string, language: string): ScannedSignal {
  return { repoPath, manifest, dependency, language };
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
