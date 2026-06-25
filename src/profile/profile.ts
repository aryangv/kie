// The living user profile. Built from local-code signals + install/reject
// decisions, persisted in SQLite, and refreshed in place — never re-pointed.
//
// We persist every discovered dependency as a signal, then aggregate into a
// compact "category coverage" view: which languages you work in, and which
// categories (testing, ORM, bundler, ...) your stack already fills and with
// what. The fit classifier consumes that view.

import { homedir } from "node:os";
import { join } from "node:path";
import type { Store, ProfileRow } from "../store/db.js";
import type { Tool } from "../types.js";
import { scanRoots, type ScannedSignal } from "./scanner.js";
import { categorize, categorizeDependency } from "../match/taxonomy.js";

export interface ProfileView {
  languages: Set<string>; // lowercased
  /** category -> the stack items already covering it. */
  categoryIncumbents: Map<string, string[]>;
  rows: ProfileRow[];
  isEmpty: boolean;
}

/** Code roots to scan, from KIE_CODE_ROOTS or a sensible default. */
export function codeRoots(): string[] {
  const env = process.env.KIE_CODE_ROOTS;
  if (env) return env.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  return [join(homedir(), "code")];
}

function titleCaseLang(lang: string): string {
  const special: Record<string, string> = {
    javascript: "JavaScript",
    typescript: "TypeScript",
    go: "Go",
    rust: "Rust",
    python: "Python",
  };
  return special[lang] ?? lang;
}

/** Persist scanned signals, then rebuild the language + library profile rows. */
export function rebuildProfile(store: Store, signals: ScannedSignal[]): ProfileView {
  const now = Math.floor(Date.now() / 1000);
  for (const s of signals) {
    store.addSignal(s.repoPath, s.manifest, s.dependency, now);
  }

  // Aggregate across ALL persisted signals (not just this scan) so the profile
  // accrues over time.
  const all = store.allSignals();
  const langRepos = new Map<string, Set<string>>();
  const depRepos = new Map<string, Set<string>>();
  // Re-derive language per (repo, manifest): a package.json with typescript dep
  // counts as TypeScript. We approximate using the scan's language hints when
  // present, else the manifest default.
  const manifestLang: Record<string, string> = {
    "package.json": "javascript",
    "requirements.txt": "python",
    "pyproject.toml": "python",
    "go.mod": "go",
    "Cargo.toml": "rust",
  };
  const tsRepos = new Set<string>();
  for (const sig of all) {
    if (sig.dependency === "typescript") tsRepos.add(sig.repo_path);
  }
  for (const sig of all) {
    let lang = manifestLang[sig.manifest] ?? "unknown";
    if (sig.manifest === "package.json" && tsRepos.has(sig.repo_path)) lang = "typescript";
    if (!langRepos.has(lang)) langRepos.set(lang, new Set());
    langRepos.get(lang)!.add(sig.repo_path);

    if (!depRepos.has(sig.dependency)) depRepos.set(sig.dependency, new Set());
    depRepos.get(sig.dependency)!.add(sig.repo_path);
  }

  store.clearProfileKinds(["language", "library"]);
  for (const [lang, repos] of langRepos) {
    if (lang === "unknown") continue;
    store.upsertProfileRow({
      key: `language:${lang}`,
      kind: "language",
      label: titleCaseLang(lang),
      category: null,
      weight: repos.size,
      now,
    });
  }
  for (const [dep, repos] of depRepos) {
    const category = categorizeDependency(dep);
    if (!category) continue; // keep the profile to recognized stack tech
    store.upsertProfileRow({
      key: `library:${dep}`,
      kind: "library",
      label: dep,
      category,
      weight: repos.size,
      now,
    });
  }

  return buildProfileView(store);
}

/** Default age after which the profile is rescanned lazily on the next use. */
export const PROFILE_STALE_HOURS = 24;

/** Convenience: scan the configured roots and rebuild. Stamps the scan time. */
export function scanAndRebuild(store: Store, roots: string[] = codeRoots()): ProfileView {
  const view = rebuildProfile(store, scanRoots(roots));
  store.setMeta("lastProfileScan", String(Math.floor(Date.now() / 1000)));
  return view;
}

/** Seconds since the last filesystem scan, or null if never scanned. */
export function lastProfileScan(store: Store): number | null {
  const v = store.getMeta("lastProfileScan");
  return v ? Number(v) : null;
}

/**
 * Keep the living profile current without the user thinking about it: scan the
 * configured roots if the profile has never been built or the last scan is
 * older than maxAgeHours; otherwise return the cached view untouched. This is
 * the same lazy pattern the source collector uses for trend data.
 */
export function ensureProfileFresh(
  store: Store,
  maxAgeHours: number = PROFILE_STALE_HOURS,
): ProfileView {
  const last = lastProfileScan(store);
  const stale = last === null || Date.now() / 1000 - last > maxAgeHours * 3600;
  if (stale) {
    try {
      return scanAndRebuild(store, codeRoots());
    } catch {
      // A scan failure (e.g. an unreadable root) shouldn't break the tool call;
      // fall back to whatever profile we already have.
      return buildProfileView(store);
    }
  }
  return buildProfileView(store);
}

export function buildProfileView(store: Store): ProfileView {
  const rows = store.allProfileRows();
  const languages = new Set<string>();
  const categoryIncumbents = new Map<string, string[]>();
  for (const r of rows) {
    if (r.kind === "language") languages.add(r.label.toLowerCase());
    if (r.category) {
      if (!categoryIncumbents.has(r.category)) categoryIncumbents.set(r.category, []);
      categoryIncumbents.get(r.category)!.push(r.label);
    }
  }
  return { languages, categoryIncumbents, rows, isEmpty: rows.length === 0 };
}

/**
 * Record an accept/reject/install decision. Installing or accepting a tool adds
 * its categories to the profile so similar tools later read as "replaces".
 */
export function recordDecision(
  store: Store,
  tool: Tool,
  decision: "accepted" | "rejected" | "installed",
  note: string | null = null,
): ProfileView {
  const now = Math.floor(Date.now() / 1000);
  store.setDecision(tool.id, decision, note, now);

  if (decision === "installed" || decision === "accepted") {
    const cats = categorize({ name: tool.name, topics: tool.topics, description: tool.description });
    if (cats.size === 0) {
      store.upsertProfileRow({
        key: `tool:${tool.repoRef}`,
        kind: "tool",
        label: tool.repoRef,
        category: null,
        weight: 3,
        now,
      });
    } else {
      for (const cat of cats) {
        store.upsertProfileRow({
          key: `tool:${tool.repoRef}:${cat}`,
          kind: "tool",
          label: tool.repoRef,
          category: cat,
          weight: 3,
          now,
        });
      }
    }
  }
  return buildProfileView(store);
}
