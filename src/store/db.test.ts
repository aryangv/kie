import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { Store, runMigrations, CURRENT_SCHEMA_VERSION } from "./db.js";

const userVersion = (db: Database.Database) => db.pragma("user_version", { simple: true }) as number;
const hasColumn = (db: Database.Database, table: string, col: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);

test("sets a busy_timeout so concurrent writers wait instead of erroring", () => {
  const store = new Store(":memory:");
  const timeout = store.db.pragma("busy_timeout", { simple: true }) as number;
  assert.equal(timeout, 5000);
  store.close();
});

test("KIE_BUSY_TIMEOUT_MS overrides the busy_timeout", () => {
  const prev = process.env.KIE_BUSY_TIMEOUT_MS;
  process.env.KIE_BUSY_TIMEOUT_MS = "1234";
  try {
    const store = new Store(":memory:");
    assert.equal(store.db.pragma("busy_timeout", { simple: true }), 1234);
    store.close();
  } finally {
    if (prev === undefined) delete process.env.KIE_BUSY_TIMEOUT_MS;
    else process.env.KIE_BUSY_TIMEOUT_MS = prev;
  }
});

test("a fresh DB is migrated to the current schema version", () => {
  const store = new Store(":memory:");
  assert.equal(userVersion(store.db), CURRENT_SCHEMA_VERSION);
  assert.ok(hasColumn(store.db, "tools", "readme"));
  store.close();
});

test("runMigrations is idempotent — re-running applies nothing", () => {
  const store = new Store(":memory:");
  runMigrations(store.db); // second pass on an already-current DB
  runMigrations(store.db);
  assert.equal(userVersion(store.db), CURRENT_SCHEMA_VERSION);
  store.close();
});

test("upgrades a legacy DB (pre-readme tools table) without losing data", () => {
  // Simulate a database created before versioning + before the readme column:
  // user_version defaults to 0 and `tools` lacks `readme`.
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_ref TEXT NOT NULL UNIQUE, url TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT, language TEXT, topics TEXT NOT NULL DEFAULT '[]',
    current_stars INTEGER NOT NULL DEFAULT 0, first_seen INTEGER NOT NULL
  )`);
  db.prepare("INSERT INTO tools(repo_ref, url, name, first_seen) VALUES (?, ?, ?, ?)").run(
    "old/repo", "https://github.com/old/repo", "repo", 1,
  );
  assert.equal(userVersion(db), 0);
  assert.ok(!hasColumn(db, "tools", "readme"), "precondition: legacy DB lacks readme");

  runMigrations(db);

  assert.equal(userVersion(db), CURRENT_SCHEMA_VERSION, "version recorded");
  assert.ok(hasColumn(db, "tools", "readme"), "readme backfilled");
  const row = db.prepare("SELECT name, readme FROM tools WHERE repo_ref = 'old/repo'").get() as
    | { name: string; readme: string | null }
    | undefined;
  assert.equal(row?.name, "repo", "existing row preserved");
  assert.equal(row?.readme, null, "new column defaults to null");
  // Tables introduced by the base schema are created during the upgrade too.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  for (const t of ["mentions", "tool_metrics", "scores", "profile", "decisions"]) {
    assert.ok(tables.some((r) => r.name === t), `${t} created on upgrade`);
  }
  db.close();
});
