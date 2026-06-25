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
import {
  recencyWeight,
  inferCategoriesByCooccurrence,
  inferArchetypes,
  type Archetype,
} from "../match/infer.js";

/** Confidence at/above which a category row counts as an "incumbent" the fit
 * classifier can treat as "you already do this". Observed deps are 1.0; low-
 * confidence co-occurrence inferences sit below this so they enrich the picture
 * without forcing a "replaces" verdict. */
export const INCUMBENT_CONFIDENCE = 0.75;

export interface ProfileView {
  languages: Set<string>; // lowercased
  /** category -> the stack items already covering it (high-confidence only). */
  categoryIncumbents: Map<string, string[]>;
  /** category -> recency-weighted, confidence-scaled total strength (all rows). */
  categoryStrength?: Map<string, number>;
  /** Categories present ONLY via low-confidence inference (no observed incumbent). */
  inferredCategories?: Set<string>;
  /** Inferred developer personas, strongest first. */
  archetypes?: Archetype[];
  /** Learned accept(+)/reject(-) affinity per category or language label. */
  affinities?: Map<string, number>;
  /** Observed dependencies the taxonomy still can't categorize (the raw tail). */
  uncategorized?: string[];
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

/** Persist scanned signals, then rebuild the language + library profile rows.
 *
 * Three inference passes turn the raw signals into a richer profile:
 *  1. Recency weighting — a dep's weight is the sum, over the repos that declare
 *     it, of how recently each was touched (manifest mtime). Stale projects fade;
 *     what you work on *now* dominates. (All-fresh signals reduce to repo count,
 *     preserving the old semantics.)
 *  2. Co-occurrence categorization — deps the taxonomy doesn't know are inferred
 *     from the categories they ship alongside, instead of being dropped.
 *  3. Anything still unknown is kept as a raw, uncategorized library row — the
 *     distinctive tail the host model (or a future taxonomy entry) can place. */
export function rebuildProfile(store: Store, signals: ScannedSignal[]): ProfileView {
  const now = Math.floor(Date.now() / 1000);
  for (const s of signals) {
    store.addSignal(s.repoPath, s.manifest, s.dependency, now, s.mtime ?? null);
  }

  // Aggregate across ALL persisted signals (not just this scan) so the profile
  // accrues over time.
  const all = store.allSignals();
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

  // Per (dep, repo) keep the most-recent recency weight; per language track the
  // recency-weighted reach; collect each repo's dep set for co-occurrence.
  const langRepoRecency = new Map<string, Map<string, number>>();
  const depRepoRecency = new Map<string, Map<string, number>>();
  const repoDeps = new Map<string, Set<string>>();
  for (const sig of all) {
    const rw = recencyWeight(sig.mtime ?? sig.seen_at, now);
    let lang = manifestLang[sig.manifest] ?? "unknown";
    if (sig.manifest === "package.json" && tsRepos.has(sig.repo_path)) lang = "typescript";
    bumpRepoRecency(langRepoRecency, lang, sig.repo_path, rw);
    bumpRepoRecency(depRepoRecency, sig.dependency, sig.repo_path, rw);
    if (!repoDeps.has(sig.repo_path)) repoDeps.set(sig.repo_path, new Set());
    repoDeps.get(sig.repo_path)!.add(sig.dependency);
  }

  // Infer categories for the deps the taxonomy can't place, from their company.
  const inferred = inferCategoriesByCooccurrence({
    repos: [...repoDeps.values()].map((s) => ({ deps: [...s] })),
    categoryOf: (d) => categorizeDependency(d),
  });

  store.clearProfileKinds(["language", "library"]);
  for (const [lang, repos] of langRepoRecency) {
    if (lang === "unknown") continue;
    store.upsertProfileRow({
      key: `language:${lang}`,
      kind: "language",
      label: titleCaseLang(lang),
      category: null,
      weight: sumWeights(repos),
      confidence: 1,
      now,
    });
  }
  for (const [dep, repos] of depRepoRecency) {
    const weight = sumWeights(repos);
    const observed = categorizeDependency(dep);
    const inf = observed ? undefined : inferred.get(dep);
    store.upsertProfileRow({
      key: `library:${dep}`,
      kind: "library",
      label: dep,
      // observed category (confidence 1), else inferred (confidence <1), else
      // kept as a raw uncategorized row so nothing distinctive is discarded.
      category: observed ?? inf?.category ?? null,
      weight,
      confidence: observed ? 1 : (inf?.confidence ?? 1),
      now,
    });
  }

  return buildProfileView(store);
}

/** Track the best (most-recent) recency weight for a key within each repo. */
function bumpRepoRecency(
  map: Map<string, Map<string, number>>,
  key: string,
  repo: string,
  rw: number,
) {
  let repos = map.get(key);
  if (!repos) {
    repos = new Map();
    map.set(key, repos);
  }
  repos.set(repo, Math.max(repos.get(repo) ?? 0, rw));
}

function sumWeights(repos: Map<string, number>): number {
  let total = 0;
  for (const v of repos.values()) total += v;
  return total;
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
  const categoryStrength = new Map<string, number>();
  const affinities = new Map<string, number>();
  const uncategorized: string[] = [];
  const highConfCats = new Set<string>();
  const lowConfCats = new Set<string>();

  for (const r of rows) {
    if (r.kind === "language") languages.add(r.label.toLowerCase());
    if (r.kind === "affinity") {
      affinities.set(r.label, (affinities.get(r.label) ?? 0) + r.weight);
      continue;
    }
    if (r.kind === "library" && r.category === null) uncategorized.push(r.label);
    if (r.category) {
      categoryStrength.set(
        r.category,
        (categoryStrength.get(r.category) ?? 0) + r.weight * r.confidence,
      );
      if (r.confidence >= INCUMBENT_CONFIDENCE) {
        highConfCats.add(r.category);
        if (!categoryIncumbents.has(r.category)) categoryIncumbents.set(r.category, []);
        categoryIncumbents.get(r.category)!.push(r.label);
      } else {
        lowConfCats.add(r.category);
      }
    }
  }

  const inferredCategories = new Set<string>();
  for (const c of lowConfCats) if (!highConfCats.has(c)) inferredCategories.add(c);

  return {
    languages,
    categoryIncumbents,
    categoryStrength,
    inferredCategories,
    archetypes: inferArchetypes(categoryStrength),
    affinities,
    uncategorized,
    rows,
    isEmpty: rows.length === 0,
  };
}

/**
 * Record an accept/reject/install decision. Installing or accepting a tool adds
 * its categories to the profile so similar tools later read as "replaces". Every
 * decision — accept or reject — also nudges a learned affinity per category and
 * language, so the profile infers what kinds of tools you tend to take or pass on.
 */
export function recordDecision(
  store: Store,
  tool: Tool,
  decision: "accepted" | "rejected" | "installed",
  note: string | null = null,
): ProfileView {
  const now = Math.floor(Date.now() / 1000);
  store.setDecision(tool.id, decision, note, now);

  // Learn affinities from behavior: +1 toward what you accept/install, -1 away
  // from what you reject, accumulated per category and per language.
  const delta = decision === "rejected" ? -1 : 1;
  const decisionCats = categorize({
    name: tool.name,
    topics: tool.topics,
    description: tool.description,
  });
  for (const cat of decisionCats) {
    store.bumpAffinity(`affinity:cat:${cat}`, cat, cat, delta, now);
  }
  const lang = tool.language?.toLowerCase();
  if (lang) store.bumpAffinity(`affinity:lang:${lang}`, lang, null, delta, now);

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
