// Inference layer over the raw profile signals. Where taxonomy.ts is a literal
// lookup (dep -> category), this module *infers* the things a lookup can't:
//   - how *current* a signal is (recency decay over when you last touched a repo),
//   - what an *unknown* dependency probably is (co-occurrence: a dep that always
//     ships alongside vite/vitest/react is almost certainly frontend tooling),
//   - what *kind of developer* the profile describes (archetype roll-up over the
//     categories your stack covers).
//
// Everything here is pure and deterministic — no LLM, no network — so it's unit
// testable and stays true to Kie's keyless identity. The host-model lane (see
// profile_infer) layers on top of this for the fuzzy tail co-occurrence can't reach.

/** Half-life (days) for recency decay: a signal this old counts half as much. */
export const RECENCY_HALF_LIFE_DAYS = 60;
/** Floor so an old-but-still-present dependency never decays fully to zero. */
const RECENCY_FLOOR = 0.05;

/**
 * Recency weight in (0,1]: 1.0 for something touched now, halving every
 * RECENCY_HALF_LIFE_DAYS, floored at RECENCY_FLOOR. `at` and `now` are unix
 * seconds; a missing/future `at` is treated as "now" (full weight).
 */
export function recencyWeight(at: number | null | undefined, now: number): number {
  if (!at || at >= now) return 1;
  const ageDays = (now - at) / 86400;
  const decayed = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
  return Math.max(RECENCY_FLOOR, decayed);
}

export interface CooccurrenceInput {
  /** One entry per repo: the dependency names declared in it. */
  repos: { deps: string[] }[];
  /** Known category for a dep, or undefined if the taxonomy doesn't recognize it. */
  categoryOf: (dep: string) => string | undefined;
}

export interface InferredCategory {
  category: string;
  /** 0..MAX_COOCCURRENCE_CONFIDENCE — deliberately below the "incumbent" bar. */
  confidence: number;
}

/** Co-occurrence inferences never reach the confidence of an observed dependency,
 * so they enrich the profile and feed archetypes without forcing "replaces". */
export const MAX_COOCCURRENCE_CONFIDENCE = 0.6;
/** A dep must co-occur with its winning category in at least this many repos. */
const MIN_COOCCURRENCE_SUPPORT = 2;
/** ...and that category must dominate at least this fraction of the dep's repos. */
const MIN_COOCCURRENCE_SHARE = 0.5;

/**
 * Infer a category for each dependency the taxonomy can't place, from the
 * company it keeps: across the repos that contain an unknown dep, tally the
 * known categories that appear alongside it and take the dominant one — but only
 * if it clears a support floor and a majority share, so we stay conservative.
 */
export function inferCategoriesByCooccurrence(
  input: CooccurrenceInput,
): Map<string, InferredCategory> {
  const { repos, categoryOf } = input;
  // unknown dep -> (category -> # of repos where they co-occur)
  const votes = new Map<string, Map<string, number>>();
  const repoCount = new Map<string, number>(); // unknown dep -> # repos containing it

  for (const repo of repos) {
    const known = new Set<string>();
    const unknown: string[] = [];
    for (const dep of repo.deps) {
      const cat = categoryOf(dep);
      if (cat) known.add(cat);
      else unknown.push(dep);
    }
    if (known.size === 0) continue; // no anchor categories to borrow from
    for (const dep of unknown) {
      repoCount.set(dep, (repoCount.get(dep) ?? 0) + 1);
      const tally = votes.get(dep) ?? new Map<string, number>();
      for (const cat of known) tally.set(cat, (tally.get(cat) ?? 0) + 1);
      votes.set(dep, tally);
    }
  }

  const out = new Map<string, InferredCategory>();
  for (const [dep, tally] of votes) {
    const total = repoCount.get(dep) ?? 0;
    let bestCat = "";
    let bestVotes = 0;
    for (const [cat, n] of tally) {
      if (n > bestVotes) {
        bestVotes = n;
        bestCat = cat;
      }
    }
    if (bestVotes < MIN_COOCCURRENCE_SUPPORT) continue;
    const share = total > 0 ? bestVotes / total : 0;
    if (share < MIN_COOCCURRENCE_SHARE) continue;
    out.set(dep, {
      category: bestCat,
      confidence: Math.min(MAX_COOCCURRENCE_CONFIDENCE, share * MAX_COOCCURRENCE_CONFIDENCE + 0.2),
    });
  }
  return out;
}

// ---- archetype roll-up ----------------------------------------------------

/** Domain personas, each defined by the taxonomy categories that imply it. */
const ARCHETYPE_CATEGORIES: Record<string, string[]> = {
  frontend: [
    "ui-framework", "css", "state-management", "bundler", "animation", "forms",
    "data-fetching", "rich-text-editor", "static-site", "i18n",
  ],
  backend: [
    "web-framework", "orm", "database", "auth", "queue", "caching", "graphql",
    "api", "realtime", "email", "payments", "http-client",
  ],
  "ai-ml": ["ai-tool", "ml", "mcp", "data"],
  "devops-infra": ["container", "infra", "ci", "devops", "monitoring", "logging"],
  "mobile-desktop": ["mobile", "desktop"],
  "creative-design": ["creative", "design", "animation", "data-viz", "game-engine"],
  "quality-tooling": ["testing", "e2e-testing", "linter", "formatter", "validation"],
};

export interface Archetype {
  name: string;
  /** Summed category strength backing this persona. */
  score: number;
  /** The categories (from your stack) that contributed, strongest first. */
  categories: string[];
}

/**
 * Roll category strengths up into developer archetypes. `categoryStrength` maps a
 * category to its recency-weighted, confidence-scaled strength (from the profile).
 * Returns archetypes with any backing signal, strongest first.
 */
export function inferArchetypes(categoryStrength: Map<string, number>): Archetype[] {
  const out: Archetype[] = [];
  for (const [name, cats] of Object.entries(ARCHETYPE_CATEGORIES)) {
    const hits: { cat: string; w: number }[] = [];
    let score = 0;
    for (const cat of cats) {
      const w = categoryStrength.get(cat);
      if (w && w > 0) {
        hits.push({ cat, w });
        score += w;
      }
    }
    if (score > 0) {
      hits.sort((a, b) => b.w - a.w);
      out.push({ name, score, categories: hits.map((h) => h.cat) });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
