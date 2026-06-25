// SQLite persistence layer for Kie.
//
// One Database wrapper exposes typed helpers for every table the rest of the
// app needs. Tests pass ":memory:" for an ephemeral db; production defaults to
// ~/.kie/kie.db (override with KIE_DB).

import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { RawMention, RepoMeta, Tool } from "../types.js";

// The base schema (migration v1). For a fresh DB this creates every table with
// all current columns; for an existing DB every statement is a no-op. Never edit
// this to add a column to a shipped table — add a migration below instead, so
// databases created before the change get upgraded rather than silently lacking
// the column.
const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tools (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_ref      TEXT NOT NULL UNIQUE,
  url           TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  language      TEXT,
  topics        TEXT NOT NULL DEFAULT '[]',
  current_stars INTEGER NOT NULL DEFAULT 0,
  readme        TEXT,
  first_seen    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mentions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  tool_id      INTEGER NOT NULL REFERENCES tools(id),
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  author       TEXT,
  points       INTEGER NOT NULL DEFAULT 0,
  comments     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  UNIQUE (source, external_id, tool_id)
);
CREATE INDEX IF NOT EXISTS idx_mentions_tool ON mentions(tool_id);
CREATE INDEX IF NOT EXISTS idx_mentions_created ON mentions(created_at);

CREATE TABLE IF NOT EXISTS tool_metrics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id       INTEGER NOT NULL REFERENCES tools(id),
  captured_at   INTEGER NOT NULL,
  stars         INTEGER NOT NULL,
  mention_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_tool ON tool_metrics(tool_id);

CREATE TABLE IF NOT EXISTS scores (
  tool_id      INTEGER NOT NULL REFERENCES tools(id),
  time_window  TEXT NOT NULL,
  score        REAL NOT NULL,
  breakdown    TEXT NOT NULL,
  computed_at  INTEGER NOT NULL,
  PRIMARY KEY (tool_id, time_window)
);

-- Profile tables (populated in Slice 2; created now so the schema is stable).
CREATE TABLE IF NOT EXISTS profile (
  key       TEXT PRIMARY KEY,   -- e.g. "language:typescript", "library:react"
  kind      TEXT NOT NULL,      -- language | library | tool | affinity | category
  label     TEXT NOT NULL,
  category  TEXT,               -- taxonomy category this item covers (nullable)
  weight    REAL NOT NULL DEFAULT 1,
  -- 1.0 = directly observed; <1 = inferred (co-occurrence / host model). The fit
  -- classifier only treats high-confidence rows as "incumbents".
  confidence REAL NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_signals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_path  TEXT NOT NULL,
  manifest   TEXT NOT NULL,     -- e.g. package.json
  dependency TEXT NOT NULL,
  seen_at    INTEGER NOT NULL,
  mtime      INTEGER,           -- manifest file mtime (unix s); recency-of-work signal
  UNIQUE (repo_path, manifest, dependency)
);

CREATE TABLE IF NOT EXISTS decisions (
  tool_id    INTEGER NOT NULL REFERENCES tools(id),
  decision   TEXT NOT NULL,     -- accepted | rejected | installed
  note       TEXT,
  decided_at INTEGER NOT NULL,
  PRIMARY KEY (tool_id)
);
`;

// ---- migrations ----------------------------------------------------------
//
// Schema evolution is versioned with SQLite's `PRAGMA user_version`. Each
// migration runs once, in order, inside a transaction (so a failure rolls back
// cleanly and never leaves a half-applied schema). To change the schema, append
// a new migration here — never edit a past one, and never add a column by
// editing BASE_SCHEMA alone (existing DBs won't pick it up).
//
// Column-adds are guarded (addColumnIfMissing) so the same migration is a no-op
// on a fresh DB that already got the column from BASE_SCHEMA and an ALTER on an
// older DB that predates it. That keeps one migration list correct for both.

interface Migration {
  version: number;
  up: (db: Database.Database) => void;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  decl: string,
) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

const MIGRATIONS: Migration[] = [
  // v1 — the base schema (idempotent CREATE TABLE IF NOT EXISTS for every table).
  { version: 1, up: (db) => db.exec(BASE_SCHEMA) },
  // v2 — `tools.readme` was introduced after the earliest DBs were created.
  // Those DBs have a `tools` table without it, and applyRepoMeta's
  // `UPDATE tools SET ... readme = ?` would throw "no such column: readme".
  // Backfill it (no-op where BASE_SCHEMA already provided it).
  { version: 2, up: (db) => addColumnIfMissing(db, "tools", "readme", "TEXT") },
  // v3 — inference layer: `profile.confidence` (observed vs inferred rows) and
  // `profile_signals.mtime` (recency-of-work weighting). Both guarded so this is
  // a no-op on a fresh DB that already got them from BASE_SCHEMA and an ALTER on
  // an older one.
  {
    version: 3,
    up: (db) => {
      addColumnIfMissing(db, "profile", "confidence", "REAL NOT NULL DEFAULT 1");
      addColumnIfMissing(db, "profile_signals", "mtime", "INTEGER");
    },
  },
];

/** The schema version a freshly-migrated DB ends at. */
export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * Bring `db` up to {@link CURRENT_SCHEMA_VERSION}, applying only the migrations
 * newer than its recorded `user_version`. Each is wrapped in a transaction with
 * the version bump, so the DB is always at a consistent, recorded version.
 */
export function runMigrations(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const apply = db.transaction(() => {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.version}`);
    });
    apply();
  }
}

export function defaultDbPath(): string {
  if (process.env.KIE_DB) return process.env.KIE_DB;
  const dir = join(homedir(), ".kie");
  mkdirSync(dir, { recursive: true });
  return join(dir, "kie.db");
}

export interface ToolRow {
  id: number;
  repo_ref: string;
  url: string;
  name: string;
  description: string | null;
  language: string | null;
  topics: string;
  current_stars: number;
  readme: string | null;
  first_seen: number;
}

function rowToTool(r: ToolRow): Tool {
  return {
    id: r.id,
    repoRef: r.repo_ref,
    url: r.url,
    name: r.name,
    description: r.description,
    language: r.language,
    topics: JSON.parse(r.topics) as string[],
    currentStars: r.current_stars,
    readme: r.readme,
    firstSeen: r.first_seen,
  };
}

export class Store {
  readonly db: Database.Database;

  constructor(path: string = defaultDbPath()) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    // The IDE server and the background daemon can write the same DB. WAL lets
    // readers run concurrently with the single writer; busy_timeout makes a
    // would-be second writer wait (up to N ms) for the lock instead of throwing
    // SQLITE_BUSY immediately. Overridable via KIE_BUSY_TIMEOUT_MS.
    const busyMs = Number(process.env.KIE_BUSY_TIMEOUT_MS ?? 5000);
    this.db.pragma(`busy_timeout = ${busyMs}`);
    runMigrations(this.db);
  }

  close() {
    this.db.close();
  }

  // ---- meta ----------------------------------------------------------------

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  // ---- tools ---------------------------------------------------------------

  /** Insert a tool by repoRef if absent; returns its id either way. */
  upsertTool(repoRef: string, url: string, name: string, now: number): number {
    const existing = this.db
      .prepare("SELECT id FROM tools WHERE repo_ref = ?")
      .get(repoRef) as { id: number } | undefined;
    if (existing) return existing.id;
    const info = this.db
      .prepare(
        "INSERT INTO tools(repo_ref, url, name, first_seen) VALUES (?, ?, ?, ?)",
      )
      .run(repoRef, url, name, now);
    return Number(info.lastInsertRowid);
  }

  /** Apply enriched GitHub metadata onto an existing tool row. */
  applyRepoMeta(toolId: number, meta: RepoMeta) {
    this.db
      .prepare(
        `UPDATE tools SET description = ?, language = ?, topics = ?, current_stars = ?, readme = ?
         WHERE id = ?`,
      )
      .run(
        meta.description,
        meta.language,
        JSON.stringify(meta.topics),
        meta.stars,
        meta.readme,
        toolId,
      );
  }

  getTool(toolId: number): Tool | undefined {
    const r = this.db.prepare("SELECT * FROM tools WHERE id = ?").get(toolId) as
      | ToolRow
      | undefined;
    return r ? rowToTool(r) : undefined;
  }

  getToolByRef(repoRef: string): Tool | undefined {
    const r = this.db.prepare("SELECT * FROM tools WHERE repo_ref = ?").get(repoRef) as
      | ToolRow
      | undefined;
    return r ? rowToTool(r) : undefined;
  }

  allTools(): Tool[] {
    const rows = this.db.prepare("SELECT * FROM tools").all() as ToolRow[];
    return rows.map(rowToTool);
  }

  // ---- mentions ------------------------------------------------------------

  /** Persist a mention (deduped on source+externalId+tool). Returns true if new. */
  insertMention(m: RawMention, toolId: number): boolean {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO mentions
           (source, external_id, tool_id, title, url, author, points, comments, created_at)
         VALUES (@source, @externalId, @toolId, @title, @url, @author, @points, @comments, @createdAt)`,
      )
      .run({
        source: m.source,
        externalId: m.externalId,
        toolId,
        title: m.title,
        url: m.url,
        author: m.author ?? null,
        points: m.points,
        comments: m.comments ?? 0,
        createdAt: m.createdAt,
      });
    return info.changes > 0;
  }

  /** All mentions for a tool, newest first. */
  mentionsForTool(toolId: number): MentionRow[] {
    return this.db
      .prepare("SELECT * FROM mentions WHERE tool_id = ? ORDER BY created_at DESC")
      .all(toolId) as MentionRow[];
  }

  // ---- metrics -------------------------------------------------------------

  recordMetric(toolId: number, capturedAt: number, stars: number, mentionCount: number) {
    this.db
      .prepare(
        "INSERT INTO tool_metrics(tool_id, captured_at, stars, mention_count) VALUES (?, ?, ?, ?)",
      )
      .run(toolId, capturedAt, stars, mentionCount);
  }

  /** All metric snapshots for a tool, oldest first (the star/mention time series). */
  metricsForTool(toolId: number): MetricRow[] {
    return this.db
      .prepare("SELECT * FROM tool_metrics WHERE tool_id = ? ORDER BY captured_at ASC")
      .all(toolId) as MetricRow[];
  }

  /**
   * When this tool was last enriched, as unix seconds, or null if never. A
   * metric snapshot is recorded on every successful enrichment, so the latest
   * snapshot's timestamp doubles as the last-enrich time — used to skip
   * re-enriching repos that are still fresh.
   */
  lastEnrichedAt(toolId: number): number | null {
    const row = this.db
      .prepare("SELECT MAX(captured_at) AS t FROM tool_metrics WHERE tool_id = ?")
      .get(toolId) as { t: number | null } | undefined;
    return row?.t ?? null;
  }

  // ---- scores --------------------------------------------------------------

  saveScore(toolId: number, window: string, score: number, breakdown: string, now: number) {
    this.db
      .prepare(
        `INSERT INTO scores(tool_id, time_window, score, breakdown, computed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(tool_id, time_window) DO UPDATE SET
           score = excluded.score, breakdown = excluded.breakdown, computed_at = excluded.computed_at`,
      )
      .run(toolId, window, score, breakdown, now);
  }

  // ---- profile signals -----------------------------------------------------

  addSignal(
    repoPath: string,
    manifest: string,
    dependency: string,
    now: number,
    mtime: number | null = null,
  ) {
    // Refresh seen_at + mtime on re-scan so the recency signal tracks the latest
    // observation rather than freezing at first sight.
    this.db
      .prepare(
        `INSERT INTO profile_signals(repo_path, manifest, dependency, seen_at, mtime)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(repo_path, manifest, dependency) DO UPDATE SET
           seen_at = excluded.seen_at, mtime = excluded.mtime`,
      )
      .run(repoPath, manifest, dependency, now, mtime);
  }

  allSignals(): SignalRow[] {
    return this.db.prepare("SELECT * FROM profile_signals").all() as SignalRow[];
  }

  // ---- profile -------------------------------------------------------------

  /** Delete all profile rows of the given kinds (used before a rebuild). */
  clearProfileKinds(kinds: string[]) {
    if (kinds.length === 0) return;
    const placeholders = kinds.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM profile WHERE kind IN (${placeholders})`).run(...kinds);
  }

  upsertProfileRow(row: {
    key: string;
    kind: string;
    label: string;
    category: string | null;
    weight: number;
    confidence?: number;
    now: number;
  }) {
    this.db
      .prepare(
        `INSERT INTO profile(key, kind, label, category, weight, confidence, updated_at)
         VALUES (@key, @kind, @label, @category, @weight, @confidence, @now)
         ON CONFLICT(key) DO UPDATE SET
           label = excluded.label, category = excluded.category,
           weight = excluded.weight, confidence = excluded.confidence,
           updated_at = excluded.updated_at`,
      )
      .run({ confidence: 1, ...row });
  }

  /**
   * Increment an affinity row's signed weight (learned from accept/reject
   * decisions): +1 nudges toward a category/language, -1 away. Distinct from
   * upsertProfileRow because it accumulates rather than replaces.
   */
  bumpAffinity(key: string, label: string, category: string | null, delta: number, now: number) {
    this.db
      .prepare(
        `INSERT INTO profile(key, kind, label, category, weight, confidence, updated_at)
         VALUES (?, 'affinity', ?, ?, ?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET
           weight = weight + excluded.weight, updated_at = excluded.updated_at`,
      )
      .run(key, label, category, delta, now);
  }

  allProfileRows(): ProfileRow[] {
    return this.db.prepare("SELECT * FROM profile ORDER BY weight DESC").all() as ProfileRow[];
  }

  // ---- decisions -----------------------------------------------------------

  getDecision(toolId: number): { decision: string; note: string | null } | undefined {
    return this.db
      .prepare("SELECT decision, note FROM decisions WHERE tool_id = ?")
      .get(toolId) as { decision: string; note: string | null } | undefined;
  }

  setDecision(toolId: number, decision: string, note: string | null, now: number) {
    this.db
      .prepare(
        `INSERT INTO decisions(tool_id, decision, note, decided_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(tool_id) DO UPDATE SET
           decision = excluded.decision, note = excluded.note, decided_at = excluded.decided_at`,
      )
      .run(toolId, decision, note, now);
  }
}

export interface SignalRow {
  id: number;
  repo_path: string;
  manifest: string;
  dependency: string;
  seen_at: number;
  mtime: number | null;
}

export interface ProfileRow {
  key: string;
  kind: string;
  label: string;
  category: string | null;
  weight: number;
  confidence: number;
  updated_at: number;
}

export interface MetricRow {
  id: number;
  tool_id: number;
  captured_at: number;
  stars: number;
  mention_count: number;
}

export interface MentionRow {
  id: number;
  source: string;
  external_id: string;
  tool_id: number;
  title: string;
  url: string;
  author: string | null;
  points: number;
  comments: number;
  created_at: number;
}
